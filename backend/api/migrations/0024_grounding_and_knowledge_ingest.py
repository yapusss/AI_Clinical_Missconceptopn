"""Migration 0024 — Grounding similarity columns + knowledge ingestion state (R1)

1. `knowledge_documents` gains ingestion lifecycle state:
   - ingest_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'  ('PENDING' | 'READY' | 'FAILED')
   - ingest_error  TEXT
   - chunk_count   INT

2. `llm_analyses` gains grounding (citation-fidelity) columns:
   - grounding_similarity      NUMERIC(5,4)
   - grounding_similarity_max  NUMERIC(5,4)
   - grounding_citation_count  INT
   - grounding_payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb

3. Replaces `sp_record_llm_analysis` with v3: the 16 IN params from migration
   0011 plus 4 grounding IN params appended with DEFAULT NULL (so the current
   17-placeholder call in llm.py — 16 values + NULL for OUT — keeps working).

   DEVIATION from the brief's §4b sketch (which placed `OUT p_analysis_id UUID`
   last, after the defaulted params): PostgreSQL rejects that with "procedure
   OUT parameters cannot appear after one with a default value" (observed live
   on this PG 16.15 dev DB). The OUT param therefore sits immediately after the
   original 16 IN params and before the 4 defaulted grounding params — the
   exact shape `sp_submit_conceptual_answer` has used since 0011 (extended in
   0022), whose call sites pass NULL at the OUT slot positionally. R2's
   extended call becomes (16 values, NULL, 4 grounding values) instead of
   §8.6's (16 values, 4 grounding values, NULL); named notation
   (p_grounding_similarity => ...) also works.

   The dev DB holds TWO overloads of the procedure: pronargs=11 (the original
   V2_Full_Script.sql version) and pronargs=16 (four-tier, created by 0011 via
   CREATE OR REPLACE with a new signature, which ADDED an overload). A plain
   CREATE OR REPLACE for v3 would add a THIRD, and a 16-value CALL would then
   match two candidates ("function is not unique"). The 16-arg overload is
   therefore DROPped by exact argument types before v3 is created. The 11-arg
   legacy version is dead code and is deliberately left alone.

   `knowledge_chunks.embedding` is already `vector(1536)` with HNSW index
   `idx_knowledge_chunks_vector_hnsw`; this migration does not touch it.

REVERSE drops exactly the 7 columns added above and restores the 16-arg
procedure verbatim from `api/migrations/0011_four_tier_engine.py` lines 113-206.
"""

from django.db import migrations

FORWARD_SQL = """
-- (1) knowledge_documents ingestion state
ALTER TABLE knowledge_documents
    ADD COLUMN IF NOT EXISTS ingest_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN IF NOT EXISTS ingest_error  TEXT,
    ADD COLUMN IF NOT EXISTS chunk_count   INT;

-- (2) llm_analyses grounding columns
ALTER TABLE llm_analyses
    ADD COLUMN IF NOT EXISTS grounding_similarity      NUMERIC(5,4),
    ADD COLUMN IF NOT EXISTS grounding_similarity_max  NUMERIC(5,4),
    ADD COLUMN IF NOT EXISTS grounding_citation_count  INT,
    ADD COLUMN IF NOT EXISTS grounding_payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb;

-- (3) replace sp_record_llm_analysis (DROP first — see module docstring).
-- DROP must target the 16-arg signature by exact IN-argument types; the
-- legacy 11-arg overload stays untouched.
DROP PROCEDURE IF EXISTS sp_record_llm_analysis(
    uuid, varchar, varchar, numeric, integer, jsonb, jsonb, text,
    numeric, jsonb, integer, varchar, varchar, varchar, varchar, varchar
);

-- v3: v2 body (0011_four_tier_engine.py lines 133-205) with the 4 grounding
-- columns added to the INSERT column/VALUES lists and the grounding values
-- added to the audit metadata_json. OUT must precede the defaulted params
-- (PostgreSQL restriction) — same layout as sp_submit_conceptual_answer.
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
    -- PostgreSQL forbids an OUT param after any param with a DEFAULT, so OUT
    -- sits before the 4 defaulted grounding params (same shape as
    -- sp_submit_conceptual_answer in 0011). Positional callers pass NULL at
    -- the OUT slot, exactly like today's 16-values + NULL call site.
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
"""

REVERSE_SQL = """
-- (1) drop the v3 overload (20 IN args) by exact argument types.
DROP PROCEDURE IF EXISTS sp_record_llm_analysis(
    uuid, varchar, varchar, numeric, integer, jsonb, jsonb, text,
    numeric, jsonb, integer, varchar, varchar, varchar, varchar, varchar,
    numeric, numeric, integer, jsonb
);

-- (2) restore the 16-arg four-tier procedure VERBATIM from
--     api/migrations/0011_four_tier_engine.py lines 113-206.
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
    OUT p_analysis_id UUID
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
        CURRENT_TIMESTAMP
    );

    UPDATE submissions SET status = 'PENDING_VALIDATION' WHERE id = p_submission_id;

    INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
    VALUES (NULL, 'RECORD_FOUR_TIER_ANALYSIS', 'llm_analyses', p_analysis_id,
            jsonb_build_object(
                'submission_id', p_submission_id, 'category', p_four_tier_category,
                'risk_level', p_risk_level, 'run_number', v_next_run
            ));
END;
$$;

-- (3) drop exactly the 7 columns added by the forward migration.
ALTER TABLE llm_analyses
    DROP COLUMN IF EXISTS grounding_similarity,
    DROP COLUMN IF EXISTS grounding_similarity_max,
    DROP COLUMN IF EXISTS grounding_citation_count,
    DROP COLUMN IF EXISTS grounding_payload_json;

ALTER TABLE knowledge_documents
    DROP COLUMN IF EXISTS ingest_status,
    DROP COLUMN IF EXISTS ingest_error,
    DROP COLUMN IF EXISTS chunk_count;
"""


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0023_exam_package_expiry_behavior"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]
