"""Migration 0026 — Answer-similarity + shadow columns, reference-answer embeddings,
and `sp_record_llm_analysis` v4 (C1)

PHASE C1 ONLY. This migration is additive and behaviour-neutral: it declares storage
for the answer-cosine / reading-material change but reads none of it. No sync command,
no threshold logic, no generation, no UI.

1. `reference_answers` gains the C2 embedding cache:
   - embedding   vector(1536)  — pgvector; NOT indexed (lookup is by PK)
   - answer_hash CHAR(64)      — sha256 of the *effective* reference text; C2 fills it

2. `llm_analyses` gains 5 columns:
   - answer_similarity_t1 NUMERIC(5,4)
   - answer_similarity_t3 NUMERIC(5,4)
   - llm_t1_score         VARCHAR(20)
   - llm_t3_score         VARCHAR(20)
   - verdict_shadow_json  JSONB NOT NULL DEFAULT '{}'::jsonb

   `verdict_shadow_json` is NOT optional. The shadow verdict is only reproducible if
   the theta (threshold) in force when it was computed is recorded with it. Its shape is
   `{rule_t1, rule_t3, sim_t1, sim_t3, threshold_t1, threshold_t3, source}`;
   C3 populates it. Without the thresholds, `verdict_agreement_rate` is a moving target
   and history is uninterpretable. `answer_similarity_t1/t3` stay first-class NUMERIC so
   means/medians compute in SQL; everything else lives in the JSONB.

   No `misconception_id` anywhere (D12). No `verdict_source` column — the setting selects
   the `PROMPT_VERSION` string, which `llm_analyses.prompt_version` already records per row.

3. `sp_record_llm_analysis` -> v4.

   Two overloads exist live: `pronargs = 11` (legacy `V2_Full_Script.sql`, dead) and
   `pronargs = 20` (v3, created by migration 0024). A plain `CREATE OR REPLACE` for v4
   would add a THIRD overload, so the 20-arg one is DROPped by its exact argument types
   first. The 11-arg legacy overload is deliberately left alone.

   v4 appends 5 IN params AFTER the 4 grounding params, each DEFAULT NULL. Result:
   `pronargs` 20 -> 25; a full CALL has 26 placeholders (16 values + NULL for OUT +
   4 grounding + 5 new). The existing 21-placeholder call in `llm.py` (16 values + NULL
   for OUT + 4 grounding) keeps resolving against v4 via the trailing defaults — the
   acceptance proof for this phase is BY EXECUTION (a rolled-back CALL), not a `pg_proc`
   arity read.

   Layout note (matches the deviation recorded in 0024): PostgreSQL rejects an OUT
   parameter that appears after one with a DEFAULT ("procedure OUT parameters cannot
   appear after one with a default value"). `OUT p_analysis_id UUID` therefore cannot be
   the literal last declared parameter once defaulted params exist. It stays immediately
   after the original 16 IN params and before the first defaulted (grounding) param — the
   exact shape v3 already uses — and the 5 new defaulted params are appended after the
   grounding ones. This yields the required `pronargs = 25`.

   Body = the v3 body with the 5 new columns added to the `INSERT INTO llm_analyses`
   column list and `VALUES` list, and to the audit `metadata_json`.

REVERSE drops exactly the 7 columns added above (2 on `reference_answers`, 5 on
`llm_analyses`) and restores the v3 (20-arg) procedure body verbatim from
`0024_grounding_and_knowledge_ingest.py`.
"""

from django.db import migrations


FORWARD_SQL = """
-- (1) reference_answers embedding cache (C2 fills the hash; no index by design).
ALTER TABLE reference_answers
    ADD COLUMN IF NOT EXISTS embedding   vector(1536),
    ADD COLUMN IF NOT EXISTS answer_hash CHAR(64);

-- (2) llm_analyses answer-similarity + shadow columns.
ALTER TABLE llm_analyses
    ADD COLUMN IF NOT EXISTS answer_similarity_t1 NUMERIC(5,4),
    ADD COLUMN IF NOT EXISTS answer_similarity_t3 NUMERIC(5,4),
    ADD COLUMN IF NOT EXISTS llm_t1_score         VARCHAR(20),
    ADD COLUMN IF NOT EXISTS llm_t3_score         VARCHAR(20),
    ADD COLUMN IF NOT EXISTS verdict_shadow_json  JSONB NOT NULL DEFAULT '{}'::jsonb;

-- (3) replace sp_record_llm_analysis with v4. DROP the 20-arg (v3) overload by its
-- exact argument types; the legacy 11-arg overload stays untouched.
DROP PROCEDURE IF EXISTS sp_record_llm_analysis(
    uuid, varchar, varchar, numeric, integer, jsonb, jsonb, text,
    numeric, jsonb, integer, varchar, varchar, varchar, varchar, varchar,
    numeric, numeric, integer, jsonb
);

CREATE OR REPLACE PROCEDURE sp_record_llm_analysis(
    IN  p_submission_id UUID,
    IN  p_model_identifier VARCHAR(100),
    IN  p_prompt_version VARCHAR(50),
    IN  p_percentage_correct DECIMAL(5, 2),
    IN  p_tier_level INT,
    IN  p_concept_breakdown JSONB,
    IN  p_suggested_materials JSONB,
    IN  p_explanation TEXT,
    IN  p_confidence DECIMAL(4, 3),
    IN  p_raw_output JSONB,
    IN  p_execution_time_ms INT,
    IN  p_module_a_score VARCHAR(20),
    IN  p_module_b_score VARCHAR(20),
    IN  p_module_c_code VARCHAR(100),
    IN  p_four_tier_category VARCHAR(10),
    IN  p_risk_level VARCHAR(20),
    -- OUT precedes the defaulted params (PostgreSQL restriction; see module docstring).
    OUT p_analysis_id UUID,
    IN  p_grounding_similarity NUMERIC(5,4) DEFAULT NULL,
    IN  p_grounding_similarity_max NUMERIC(5,4) DEFAULT NULL,
    IN  p_grounding_citation_count INT DEFAULT NULL,
    IN  p_grounding_payload JSONB DEFAULT '{}'::jsonb,
    -- C1: 5 new IN params appended after the grounding params, each DEFAULT NULL.
    IN  p_answer_similarity_t1 NUMERIC(5,4) DEFAULT NULL,
    IN  p_answer_similarity_t3 NUMERIC(5,4) DEFAULT NULL,
    IN  p_llm_t1_score VARCHAR(20) DEFAULT NULL,
    IN  p_llm_t3_score VARCHAR(20) DEFAULT NULL,
    IN  p_verdict_shadow JSONB DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_subject_id UUID;
    v_tier_id UUID;
    v_tier_level INT;
    v_tier_label VARCHAR(100);
    v_next_run INT;
BEGIN
    SELECT subject_id INTO v_subject_id
    FROM submissions WHERE id = p_submission_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Submission % does not exist', p_submission_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM submissions
        WHERE id = p_submission_id AND status = 'ANALYZING'
    ) THEN
        RAISE EXCEPTION 'Submission % is not in ANALYZING state; refusing to record analysis',
            p_submission_id;
    END IF;

    SELECT tier_id, tier_level, tier_label
    INTO v_tier_id, v_tier_level, v_tier_label
    FROM fn_resolve_diagnostic_tier(v_subject_id, p_tier_level);

    SELECT COALESCE(MAX(run_number), 0) + 1
    INTO v_next_run
    FROM llm_analyses WHERE submission_id = p_submission_id;

    IF v_next_run > 1 THEN
        UPDATE llm_analyses
        SET is_current = FALSE
        WHERE submission_id = p_submission_id AND is_current = TRUE;
    END IF;

    p_analysis_id := gen_random_uuid();

    INSERT INTO llm_analyses (
        id, submission_id, run_number, is_current,
        model_identifier, prompt_version,
        percentage_correct,
        tier_id, tier_level_snapshot, tier_label_snapshot,
        concept_breakdown_json, suggested_materials_json,
        explanation, confidence, raw_output_json,
        execution_time_ms,
        module_a_score, module_b_score, module_c_code,
        four_tier_category, risk_level,
        grounding_similarity, grounding_similarity_max,
        grounding_citation_count, grounding_payload_json,
        answer_similarity_t1, answer_similarity_t3,
        llm_t1_score, llm_t3_score, verdict_shadow_json,
        created_at
    ) VALUES (
        p_analysis_id, p_submission_id, v_next_run, TRUE,
        p_model_identifier, p_prompt_version,
        p_percentage_correct,
        v_tier_id, v_tier_level, v_tier_label,
        p_concept_breakdown, p_suggested_materials,
        p_explanation, p_confidence, p_raw_output,
        p_execution_time_ms,
        p_module_a_score, p_module_b_score, p_module_c_code,
        p_four_tier_category, p_risk_level,
        p_grounding_similarity, p_grounding_similarity_max,
        p_grounding_citation_count, COALESCE(p_grounding_payload, '{}'::jsonb),
        p_answer_similarity_t1, p_answer_similarity_t3,
        p_llm_t1_score, p_llm_t3_score, COALESCE(p_verdict_shadow, '{}'::jsonb),
        CURRENT_TIMESTAMP
    );

    UPDATE submissions SET status = 'PENDING_VALIDATION' WHERE id = p_submission_id;

    INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
    VALUES (NULL, 'RECORD_FOUR_TIER_ANALYSIS', 'llm_analyses', p_analysis_id,
            jsonb_build_object(
                'submission_id', p_submission_id, 'category', p_four_tier_category,
                'risk_level', p_risk_level, 'run_number', v_next_run,
                'grounding_similarity', p_grounding_similarity,
                'grounding_similarity_max', p_grounding_similarity_max,
                'grounding_citation_count', p_grounding_citation_count,
                'answer_similarity_t1', p_answer_similarity_t1,
                'answer_similarity_t3', p_answer_similarity_t3,
                'llm_t1_score', p_llm_t1_score,
                'llm_t3_score', p_llm_t3_score,
                'verdict_shadow', p_verdict_shadow
            ));
END;
$$;
"""


REVERSE_SQL = """
-- (1) drop the v4 overload (25 IN args) by exact argument types.
DROP PROCEDURE IF EXISTS sp_record_llm_analysis(
    uuid, varchar, varchar, numeric, integer, jsonb, jsonb, text,
    numeric, jsonb, integer, varchar, varchar, varchar, varchar, varchar,
    numeric, numeric, integer, jsonb,
    numeric, numeric, varchar, varchar, jsonb
);

-- (2) restore the v3 (20-arg) procedure VERBATIM from
--     0024_grounding_and_knowledge_ingest.py.
CREATE OR REPLACE PROCEDURE sp_record_llm_analysis(
    IN  p_submission_id UUID,
    IN  p_model_identifier VARCHAR(100),
    IN  p_prompt_version VARCHAR(50),
    IN  p_percentage_correct DECIMAL(5, 2),
    IN  p_tier_level INT,
    IN  p_concept_breakdown JSONB,
    IN  p_suggested_materials JSONB,
    IN  p_explanation TEXT,
    IN  p_confidence DECIMAL(4, 3),
    IN  p_raw_output JSONB,
    IN  p_execution_time_ms INT,
    IN  p_module_a_score VARCHAR(20),
    IN  p_module_b_score VARCHAR(20),
    IN  p_module_c_code VARCHAR(100),
    IN  p_four_tier_category VARCHAR(10),
    IN  p_risk_level VARCHAR(20),
    OUT p_analysis_id UUID,
    IN  p_grounding_similarity NUMERIC(5,4) DEFAULT NULL,
    IN  p_grounding_similarity_max NUMERIC(5,4) DEFAULT NULL,
    IN  p_grounding_citation_count INT DEFAULT NULL,
    IN  p_grounding_payload JSONB DEFAULT '{}'::jsonb
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_subject_id UUID;
    v_tier_id UUID;
    v_tier_level INT;
    v_tier_label VARCHAR(100);
    v_next_run INT;
BEGIN
    SELECT subject_id INTO v_subject_id
    FROM submissions WHERE id = p_submission_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Submission % does not exist', p_submission_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM submissions
        WHERE id = p_submission_id AND status = 'ANALYZING'
    ) THEN
        RAISE EXCEPTION 'Submission % is not in ANALYZING state; refusing to record analysis',
            p_submission_id;
    END IF;

    SELECT tier_id, tier_level, tier_label
    INTO v_tier_id, v_tier_level, v_tier_label
    FROM fn_resolve_diagnostic_tier(v_subject_id, p_tier_level);

    SELECT COALESCE(MAX(run_number), 0) + 1
    INTO v_next_run
    FROM llm_analyses WHERE submission_id = p_submission_id;

    IF v_next_run > 1 THEN
        UPDATE llm_analyses
        SET is_current = FALSE
        WHERE submission_id = p_submission_id AND is_current = TRUE;
    END IF;

    p_analysis_id := gen_random_uuid();

    INSERT INTO llm_analyses (
        id, submission_id, run_number, is_current,
        model_identifier, prompt_version,
        percentage_correct,
        tier_id, tier_level_snapshot, tier_label_snapshot,
        concept_breakdown_json, suggested_materials_json,
        explanation, confidence, raw_output_json,
        execution_time_ms,
        module_a_score, module_b_score, module_c_code,
        four_tier_category, risk_level,
        grounding_similarity, grounding_similarity_max,
        grounding_citation_count, grounding_payload_json,
        created_at
    ) VALUES (
        p_analysis_id, p_submission_id, v_next_run, TRUE,
        p_model_identifier, p_prompt_version,
        p_percentage_correct,
        v_tier_id, v_tier_level, v_tier_label,
        p_concept_breakdown, p_suggested_materials,
        p_explanation, p_confidence, p_raw_output,
        p_execution_time_ms,
        p_module_a_score, p_module_b_score, p_module_c_code,
        p_four_tier_category, p_risk_level,
        p_grounding_similarity, p_grounding_similarity_max,
        p_grounding_citation_count, COALESCE(p_grounding_payload, '{}'::jsonb),
        CURRENT_TIMESTAMP
    );

    UPDATE submissions SET status = 'PENDING_VALIDATION' WHERE id = p_submission_id;

    INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
    VALUES (NULL, 'RECORD_FOUR_TIER_ANALYSIS', 'llm_analyses', p_analysis_id,
            jsonb_build_object(
                'submission_id', p_submission_id, 'category', p_four_tier_category,
                'risk_level', p_risk_level, 'run_number', v_next_run,
                'grounding_similarity', p_grounding_similarity,
                'grounding_similarity_max', p_grounding_similarity_max,
                'grounding_citation_count', p_grounding_citation_count
            ));
END;
$$;

-- (3) drop exactly the 7 columns added by the forward migration.
ALTER TABLE llm_analyses
    DROP COLUMN IF EXISTS answer_similarity_t1,
    DROP COLUMN IF EXISTS answer_similarity_t3,
    DROP COLUMN IF EXISTS llm_t1_score,
    DROP COLUMN IF EXISTS llm_t3_score,
    DROP COLUMN IF EXISTS verdict_shadow_json;

ALTER TABLE reference_answers
    DROP COLUMN IF EXISTS embedding,
    DROP COLUMN IF EXISTS answer_hash;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0025_merge_admin_ai_model_settings_and_grounding_and_knowledge_ingest"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]
