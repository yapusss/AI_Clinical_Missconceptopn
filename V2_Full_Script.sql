-- ============================================================================
-- AI-Clinical Misconception System — Consolidated Schema & Procedures
-- Version: 2.6 (optimized)
-- Target: PostgreSQL 15+ with pgvector
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE subject_role_enum AS ENUM ('LECTURER', 'RESEARCHER', 'STUDENT');
CREATE TYPE indicator_status_enum AS ENUM ('MISSING', 'PARTIAL', 'PRESENT');
CREATE TYPE submission_status_enum AS ENUM (
    'SUBMITTED', 'ANALYZING', 'ANALYSIS_FAILED',
    'PENDING_VALIDATION', 'VALIDATED', 'REJECTED'
);
CREATE TYPE misconception_source_enum AS ENUM ('LECTURER_DEFINED', 'LLM_CANDIDATE', 'PROMOTED');
CREATE TYPE validation_status_enum AS ENUM ('ACCEPTED', 'EDITED', 'REJECTED');
CREATE TYPE anomaly_severity_enum AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE export_status_enum AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');


-- ============================================================================
-- UTILITY
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


-- ============================================================================
-- 1. IDENTITY, DOMAINS & RBAC
-- ============================================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_superuser BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER set_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL UNIQUE,
    slug VARCHAR(150) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER set_subjects_updated_at
BEFORE UPDATE ON subjects
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE user_subject_roles (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    role subject_role_enum NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_subject_role UNIQUE (user_id, subject_id, role)
);

CREATE TABLE topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_subject_topic_name UNIQUE (subject_id, name)
);


-- ============================================================================
-- 2. DIAGNOSTIC TIERS
-- ============================================================================

CREATE TABLE diagnostic_tiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID REFERENCES subjects(id) ON DELETE RESTRICT,
    level INT NOT NULL CHECK (level BETWEEN 1 AND 10),
    label VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_subject_tier_level UNIQUE NULLS NOT DISTINCT (subject_id, level)
);


-- ============================================================================
-- 3. QUESTION BANK & VERSIONING
-- ============================================================================

CREATE TABLE question_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    code VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_question_set_code_format
        CHECK (code ~ '^[A-Z0-9][A-Z0-9\-]{1,62}[A-Z0-9]$')
);

CREATE UNIQUE INDEX idx_question_sets_code_upper ON question_sets (UPPER(code));
CREATE INDEX idx_question_sets_subject_topic ON question_sets (subject_id, topic_id);

CREATE TRIGGER set_question_sets_updated_at
BEFORE UPDATE ON question_sets
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_set_id UUID NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
    order_index INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_set_question_order UNIQUE (question_set_id, order_index)
);

CREATE TABLE question_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    version_number INT NOT NULL DEFAULT 1 CHECK (version_number > 0),
    prompt TEXT NOT NULL,
    model_answer TEXT NOT NULL,
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_question_version UNIQUE (question_id, version_number)
);

CREATE INDEX idx_question_versions_question
    ON question_versions (question_id, version_number DESC);

CREATE TABLE concept_indicators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_version_id UUID NOT NULL REFERENCES question_versions(id) ON DELETE CASCADE,
    label VARCHAR(255) NOT NULL,
    description TEXT,
    weight DECIMAL(5, 4) NOT NULL CHECK (weight > 0.0000 AND weight <= 1.0000),
    order_index INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_question_indicator_order UNIQUE (question_version_id, order_index)
);

CREATE INDEX idx_concept_indicators_version ON concept_indicators (question_version_id);


-- ============================================================================
-- 4. MISCONCEPTIONS
-- ============================================================================

CREATE TABLE misconceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
    label VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    default_tier_id UUID REFERENCES diagnostic_tiers(id) ON DELETE SET NULL,
    source misconception_source_enum NOT NULL DEFAULT 'LECTURER_DEFINED',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_misconceptions_scope ON misconceptions (subject_id, topic_id, source);

CREATE TABLE question_version_misconceptions (
    question_version_id UUID NOT NULL REFERENCES question_versions(id) ON DELETE CASCADE,
    misconception_id UUID NOT NULL REFERENCES misconceptions(id) ON DELETE CASCADE,
    PRIMARY KEY (question_version_id, misconception_id)
);


-- ============================================================================
-- 5. KNOWLEDGE BASE & VECTOR RETRIEVAL
-- ============================================================================

CREATE TABLE knowledge_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
    uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    file_path VARCHAR(1024),
    mime_type VARCHAR(100) NOT NULL DEFAULT 'text/plain',
    raw_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_knowledge_documents_subject ON knowledge_documents (subject_id, topic_id);

CREATE TABLE knowledge_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    token_count INT,
    embedding vector(1536),
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_doc_chunk_index UNIQUE (document_id, chunk_index)
);

CREATE INDEX idx_knowledge_chunks_vector_hnsw
ON knowledge_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE embedding IS NOT NULL;

CREATE INDEX idx_knowledge_chunks_subject_topic ON knowledge_chunks (subject_id, topic_id);


-- ============================================================================
-- 6. PROMPT TEMPLATES & LLM MODELS
-- ============================================================================

CREATE TABLE prompt_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version VARCHAR(50) UNIQUE NOT NULL,
    system_prompt TEXT NOT NULL,
    user_template TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE llm_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier VARCHAR(100) UNIQUE NOT NULL,
    provider VARCHAR(50) NOT NULL,
    context_window INT,
    cost_per_1k_input NUMERIC(10,6),
    cost_per_1k_output NUMERIC(10,6),
    deprecated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================================
-- 7. STUDENT ACTIVITY, LLM DIAGNOSIS & VALIDATION
-- ============================================================================

CREATE TABLE submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    question_version_id UUID NOT NULL REFERENCES question_versions(id) ON DELETE RESTRICT,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    answer_text TEXT NOT NULL,
    attempt_no INT NOT NULL DEFAULT 1 CHECK (attempt_no > 0),
    status submission_status_enum NOT NULL DEFAULT 'SUBMITTED',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_answer_length CHECK (char_length(answer_text) BETWEEN 1 AND 20000),
    CONSTRAINT uq_student_question_attempt UNIQUE (student_id, question_version_id, attempt_no)
);

CREATE OR REPLACE FUNCTION trg_set_submission_subject_id() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    SELECT qs.subject_id INTO NEW.subject_id
    FROM question_versions qv
    JOIN questions q ON qv.question_id = q.id
    JOIN question_sets qs ON q.question_set_id = qs.id
    WHERE qv.id = NEW.question_version_id;

    IF NEW.subject_id IS NULL THEN
        RAISE EXCEPTION 'Cannot resolve subject_id for question_version %', NEW.question_version_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER set_submission_subject_id
BEFORE INSERT ON submissions
FOR EACH ROW EXECUTE FUNCTION trg_set_submission_subject_id();

-- [OPTIMIZATION] idx_submissions_lookup dropped — covered by uq_student_question_attempt prefix
-- [OPTIMIZATION] idx_submissions_status dropped — covered by partial queue index
CREATE INDEX idx_submissions_subject
    ON submissions (subject_id, submitted_at DESC);

CREATE INDEX idx_submissions_active_queue
    ON submissions (status, submitted_at)
    WHERE status IN ('SUBMITTED', 'ANALYZING');


-- llm_analyses — subject_id denormalized  -- [OPTIMIZATION]
CREATE TABLE llm_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,   -- denormalized
    run_number INT NOT NULL DEFAULT 1 CHECK (run_number > 0),
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    model_identifier VARCHAR(100) NOT NULL,
    prompt_version VARCHAR(50) NOT NULL,
    percentage_correct DECIMAL(5, 2) NOT NULL
        CHECK (percentage_correct >= 0.00 AND percentage_correct <= 100.00),
    tier_id UUID NOT NULL REFERENCES diagnostic_tiers(id) ON DELETE RESTRICT,
    tier_level_snapshot INT NOT NULL,
    tier_label_snapshot VARCHAR(100) NOT NULL,
    concept_breakdown_json JSONB NOT NULL,
    suggested_materials_json JSONB NOT NULL,
    explanation TEXT NOT NULL,
    confidence DECIMAL(4, 3) NOT NULL CHECK (confidence >= 0.000 AND confidence <= 1.000),
    raw_output_json JSONB NOT NULL,
    execution_time_ms INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_analysis_submission_run UNIQUE (submission_id, run_number)
);

CREATE INDEX idx_llm_analyses_submission ON llm_analyses (submission_id, created_at DESC);
CREATE INDEX idx_llm_analyses_subject ON llm_analyses (subject_id, created_at DESC);

CREATE UNIQUE INDEX uq_llm_analyses_current
    ON llm_analyses (submission_id)
    WHERE is_current = TRUE;

-- Merged trigger: populates subject_id AND validates tier-subject match
CREATE OR REPLACE FUNCTION trg_llm_analyses_bi() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_subject_id UUID;
BEGIN
    -- Populate subject_id from parent submission
    SELECT subject_id INTO v_subject_id FROM submissions WHERE id = NEW.submission_id;
    IF v_subject_id IS NULL THEN
        RAISE EXCEPTION 'Submission % does not exist', NEW.submission_id;
    END IF;
    NEW.subject_id := v_subject_id;

    -- Validate tier belongs to this subject (universal fallback allowed)
    IF NOT EXISTS (
        SELECT 1 FROM diagnostic_tiers dt
        WHERE dt.id = NEW.tier_id
          AND (dt.subject_id IS NULL OR dt.subject_id = NEW.subject_id)
    ) THEN
        RAISE EXCEPTION 'Tier % does not belong to subject %', NEW.tier_id, NEW.subject_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER set_llm_analyses_subject_and_validate_tier
BEFORE INSERT ON llm_analyses
FOR EACH ROW EXECUTE FUNCTION trg_llm_analyses_bi();


-- validations — subject_id denormalized  -- [OPTIMIZATION]
CREATE TABLE validations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id UUID NOT NULL REFERENCES llm_analyses(id) ON DELETE RESTRICT,
    lecturer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,   -- denormalized
    status validation_status_enum NOT NULL DEFAULT 'ACCEPTED',

    original_percentage DECIMAL(5, 2) NOT NULL
        CHECK (original_percentage >= 0.00 AND original_percentage <= 100.00),
    original_tier_id UUID NOT NULL REFERENCES diagnostic_tiers(id) ON DELETE RESTRICT,
    original_tier_level_snapshot INT NOT NULL,
    original_tier_label_snapshot VARCHAR(100) NOT NULL,

    final_percentage DECIMAL(5, 2)
        CHECK (final_percentage IS NULL
               OR (final_percentage >= 0.00 AND final_percentage <= 100.00)),
    final_tier_id UUID REFERENCES diagnostic_tiers(id) ON DELETE RESTRICT,
    final_tier_level_snapshot INT,
    final_tier_label_snapshot VARCHAR(100),
    final_feedback TEXT,

    is_score_modified BOOLEAN GENERATED ALWAYS AS (
        status <> 'REJECTED'
        AND (final_percentage IS DISTINCT FROM original_percentage)
    ) STORED,
    is_tier_modified BOOLEAN GENERATED ALWAYS AS (
        status <> 'REJECTED'
        AND (final_tier_id IS DISTINCT FROM original_tier_id)
    ) STORED,

    structured_diff_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes TEXT,
    validated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_validation_analysis UNIQUE (analysis_id),
    CONSTRAINT chk_final_required_unless_rejected CHECK (
        status = 'REJECTED' OR (
            final_percentage IS NOT NULL
            AND final_tier_id IS NOT NULL
            AND final_tier_level_snapshot IS NOT NULL
            AND final_tier_label_snapshot IS NOT NULL
            AND final_feedback IS NOT NULL
        )
    )
);

-- [OPTIMIZATION] Primary index for metrics queries: subject + date range
CREATE INDEX idx_validations_subject_timeline
    ON validations (subject_id, validated_at DESC)
    INCLUDE (status, is_score_modified, is_tier_modified, final_percentage, original_percentage);

CREATE INDEX idx_validations_research_metrics
    ON validations (status, is_score_modified, is_tier_modified);
CREATE INDEX idx_validations_lecturer_timeline
    ON validations (lecturer_id, validated_at DESC);

-- Merged trigger: populate subject_id + validate tiers
CREATE OR REPLACE FUNCTION trg_validations_bi() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_subject_id UUID;
BEGIN
    SELECT subject_id INTO v_subject_id FROM llm_analyses WHERE id = NEW.analysis_id;
    IF v_subject_id IS NULL THEN
        RAISE EXCEPTION 'Analysis % does not exist', NEW.analysis_id;
    END IF;
    NEW.subject_id := v_subject_id;

    IF NOT EXISTS (
        SELECT 1 FROM diagnostic_tiers dt
        WHERE dt.id = NEW.original_tier_id
          AND (dt.subject_id IS NULL OR dt.subject_id = NEW.subject_id)
    ) THEN
        RAISE EXCEPTION 'Original tier % does not belong to subject %',
            NEW.original_tier_id, NEW.subject_id;
    END IF;

    IF NEW.final_tier_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM diagnostic_tiers dt
        WHERE dt.id = NEW.final_tier_id
          AND (dt.subject_id IS NULL OR dt.subject_id = NEW.subject_id)
    ) THEN
        RAISE EXCEPTION 'Final tier % does not belong to subject %',
            NEW.final_tier_id, NEW.subject_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER set_validations_subject_and_validate_tiers
BEFORE INSERT ON validations
FOR EACH ROW EXECUTE FUNCTION trg_validations_bi();


CREATE TABLE few_shot_examples (
    id BIGSERIAL PRIMARY KEY,
    question_version_id UUID NOT NULL REFERENCES question_versions(id) ON DELETE CASCADE,
    validation_id UUID NOT NULL REFERENCES validations(id) ON DELETE CASCADE,
    student_answer_text TEXT NOT NULL,
    verified_analysis_json JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_few_shot_validation UNIQUE (validation_id)
);

CREATE INDEX idx_few_shot_active_lookup
    ON few_shot_examples (question_version_id, is_active);

CREATE TABLE correction_examples (
    id BIGSERIAL PRIMARY KEY,
    validation_id UUID NOT NULL REFERENCES validations(id) ON DELETE CASCADE,
    question_version_id UUID NOT NULL REFERENCES question_versions(id) ON DELETE CASCADE,
    student_answer_text TEXT NOT NULL,
    llm_analysis_json JSONB NOT NULL,
    corrected_analysis_json JSONB NOT NULL,
    structured_diff_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_correction_validation UNIQUE (validation_id)
);


-- ============================================================================
-- 8. EXPORT JOBS & ANOMALY FLAGS
-- ============================================================================

CREATE TABLE export_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    format VARCHAR(10) NOT NULL CHECK (format IN ('PDF','CSV')),
    scope_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status export_status_enum NOT NULL DEFAULT 'QUEUED',
    file_path VARCHAR(1024),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_export_jobs_requester ON export_jobs (requested_by, created_at DESC);

CREATE TABLE anomaly_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    flag_type VARCHAR(50) NOT NULL,
    severity anomaly_severity_enum NOT NULL,
    details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_anomaly_flags_submission ON anomaly_flags (submission_id);


-- ============================================================================
-- 9. AUDIT LOGGING
-- ============================================================================

CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_name VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_name, entity_id);
CREATE INDEX idx_audit_logs_actor_timeline ON audit_logs (actor_id, created_at DESC);


-- ============================================================================
-- 10. TIER RESOLUTION
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_resolve_diagnostic_tier(
    p_subject_id UUID,
    p_level INT
)
RETURNS TABLE (tier_id UUID, tier_level INT, tier_label VARCHAR(100))
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_tier_id UUID;
    v_level INT;
    v_label VARCHAR(100);
BEGIN
    SELECT dt.id, dt.level, dt.label
    INTO STRICT v_tier_id, v_level, v_label
    FROM diagnostic_tiers dt
    WHERE dt.is_active = TRUE
      AND dt.level = p_level
      AND (dt.subject_id = p_subject_id OR dt.subject_id IS NULL)
    ORDER BY dt.subject_id NULLS LAST
    LIMIT 1;

    RETURN QUERY SELECT v_tier_id, v_level, v_label;
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        RAISE EXCEPTION
            'Diagnostic tier level % could not be resolved for subject % (no universal fallback found)',
            p_level, p_subject_id;
END;
$$;


-- ============================================================================
-- 11. CREATE QUESTION VERSION
-- ============================================================================

CREATE OR REPLACE PROCEDURE sp_create_question_version(
    IN  p_question_id UUID,
    IN  p_prompt TEXT,
    IN  p_model_answer TEXT,
    IN  p_actor_id UUID,
    OUT p_new_version_id UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_next_version INT;
    v_subject_id UUID;
BEGIN
    SELECT qs.subject_id INTO v_subject_id
    FROM questions q
    JOIN question_sets qs ON q.question_set_id = qs.id
    WHERE q.id = p_question_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Question % does not exist', p_question_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM user_subject_roles
        WHERE user_id = p_actor_id AND subject_id = v_subject_id AND role = 'LECTURER'
    ) AND NOT EXISTS (SELECT 1 FROM users WHERE id = p_actor_id AND is_superuser = TRUE) THEN
        RAISE EXCEPTION 'Actor % is not authorized to create question versions for subject %',
            p_actor_id, v_subject_id;
    END IF;

    SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_version
    FROM question_versions
    WHERE question_id = p_question_id;

    p_new_version_id := gen_random_uuid();

    INSERT INTO question_versions (
        id, question_id, version_number, prompt, model_answer, created_by
    ) VALUES (
        p_new_version_id, p_question_id, v_next_version, p_prompt, p_model_answer, p_actor_id
    );

    INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
    VALUES (p_actor_id, 'CREATE_QUESTION_VERSION', 'question_versions', p_new_version_id,
            jsonb_build_object('question_id', p_question_id, 'version_number', v_next_version));
END;
$$;


-- ============================================================================
-- 12. PUBLISH QUESTION VERSION
-- ============================================================================

CREATE OR REPLACE PROCEDURE sp_publish_question_version(
    IN p_question_version_id UUID,
    IN p_actor_id UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_total_weight DECIMAL(7, 4);
    v_question_id UUID;
    v_is_already_published BOOLEAN;
    v_subject_id UUID;
BEGIN
    SELECT qv.question_id, qv.is_published, qs.subject_id
    INTO v_question_id, v_is_already_published, v_subject_id
    FROM question_versions qv
    JOIN questions q ON qv.question_id = q.id
    JOIN question_sets qs ON q.question_set_id = qs.id
    WHERE qv.id = p_question_version_id
    FOR UPDATE OF qv;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Question version % does not exist', p_question_version_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM user_subject_roles
        WHERE user_id = p_actor_id AND subject_id = v_subject_id AND role = 'LECTURER'
    ) AND NOT EXISTS (SELECT 1 FROM users WHERE id = p_actor_id AND is_superuser = TRUE) THEN
        RAISE EXCEPTION 'Actor % is not authorized to publish versions in subject %',
            p_actor_id, v_subject_id;
    END IF;

    IF v_is_already_published THEN
        RAISE NOTICE 'Question version % is already published', p_question_version_id;
        RETURN;
    END IF;

    SELECT COALESCE(SUM(weight), 0.0000) INTO v_total_weight
    FROM concept_indicators
    WHERE question_version_id = p_question_version_id;

    IF ABS(v_total_weight - 1.0000) > 0.0001 THEN
        RAISE EXCEPTION
            'Publication failed: Concept indicator weights must sum exactly to 1.0000. Current sum: %',
            v_total_weight;
    END IF;

    UPDATE question_versions SET is_published = TRUE WHERE id = p_question_version_id;

    INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
    VALUES (p_actor_id, 'PUBLISH_QUESTION_VERSION', 'question_versions', p_question_version_id,
            jsonb_build_object('total_indicators_weight', v_total_weight));
END;
$$;


-- ============================================================================
-- 13. SUBMIT ANSWER  (OUT parameter ahead of defaulted IN; 2-arg advisory lock)
-- ============================================================================

CREATE OR REPLACE PROCEDURE sp_submit_conceptual_answer(
    IN  p_student_id UUID,
    IN  p_question_version_id UUID,
    IN  p_answer_text TEXT,
    OUT p_out_submission_id UUID,
    IN  p_submission_id UUID DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_is_published BOOLEAN;
    v_subject_id UUID;
    v_next_attempt INT;
BEGIN
    SELECT qv.is_published, qs.subject_id
    INTO v_is_published, v_subject_id
    FROM question_versions qv
    JOIN questions q ON qv.question_id = q.id
    JOIN question_sets qs ON q.question_set_id = qs.id
    WHERE qv.id = p_question_version_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Question version % does not exist', p_question_version_id;
    END IF;

    IF NOT v_is_published THEN
        RAISE EXCEPTION 'Cannot submit to an unpublished question version %', p_question_version_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM user_subject_roles
        WHERE user_id = p_student_id AND subject_id = v_subject_id AND role = 'STUDENT'
    ) AND NOT EXISTS (SELECT 1 FROM users WHERE id = p_student_id AND is_superuser = TRUE) THEN
        RAISE EXCEPTION 'User % is not authorized to submit to subject %',
            p_student_id, v_subject_id;
    END IF;

    -- [OPTIMIZATION] Two-argument form: independent 32-bit hash for each key
    PERFORM pg_advisory_xact_lock(
        hashtext(p_student_id::text),
        hashtext(p_question_version_id::text)
    );

    SELECT COALESCE(MAX(attempt_no), 0) + 1
    INTO v_next_attempt
    FROM submissions
    WHERE student_id = p_student_id AND question_version_id = p_question_version_id;

    p_out_submission_id := COALESCE(p_submission_id, gen_random_uuid());

    INSERT INTO submissions (
        id, student_id, question_version_id, answer_text, attempt_no, status, submitted_at
    ) VALUES (
        p_out_submission_id, p_student_id, p_question_version_id, p_answer_text,
        v_next_attempt, 'SUBMITTED', CURRENT_TIMESTAMP
    );

    INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
    VALUES (p_student_id, 'SUBMIT_ANSWER', 'submissions', p_out_submission_id,
            jsonb_build_object('attempt_no', v_next_attempt));
END;
$$;


-- ============================================================================
-- 14. MARK SUBMISSION ANALYZING
-- ============================================================================

CREATE OR REPLACE PROCEDURE sp_mark_submission_analyzing(
    IN p_submission_id UUID
)
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE submissions
    SET status = 'ANALYZING'
    WHERE id = p_submission_id
      AND status IN ('SUBMITTED', 'ANALYSIS_FAILED', 'REJECTED');

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Submission % is not in a state that allows transition to ANALYZING',
            p_submission_id;
    END IF;
END;
$$;


-- ============================================================================
-- 15. RECORD LLM ANALYSIS  (skips empty is_current UPDATE on first run)
-- ============================================================================

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

    SELECT tier_id, tier_level, tier_label
    INTO v_tier_id, v_tier_level, v_tier_label
    FROM fn_resolve_diagnostic_tier(v_subject_id, p_tier_level);

    SELECT COALESCE(MAX(run_number), 0) + 1
    INTO v_next_run
    FROM llm_analyses WHERE submission_id = p_submission_id;

    -- [OPTIMIZATION] Only demote previous analysis if this isn't the first run
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
        execution_time_ms, created_at
    ) VALUES (
        p_analysis_id, p_submission_id, v_next_run, TRUE,
        p_model_identifier, p_prompt_version,
        p_percentage_correct,
        v_tier_id, v_tier_level, v_tier_label,
        p_concept_breakdown, p_suggested_materials,
        p_explanation, p_confidence, p_raw_output,
        p_execution_time_ms, CURRENT_TIMESTAMP
    );

    UPDATE submissions SET status = 'PENDING_VALIDATION' WHERE id = p_submission_id;

    INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
    VALUES (NULL, 'RECORD_LLM_ANALYSIS', 'llm_analyses', p_analysis_id,
            jsonb_build_object(
                'submission_id', p_submission_id, 'run_number', v_next_run,
                'model', p_model_identifier, 'prompt_version', p_prompt_version
            ));
END;
$$;


-- ============================================================================
-- 16. VALIDATE ANALYSIS
-- ============================================================================

CREATE OR REPLACE PROCEDURE sp_validate_analysis(
    IN  p_analysis_id UUID,
    IN  p_lecturer_id UUID,
    IN  p_status validation_status_enum,
    IN  p_final_percentage DECIMAL(5, 2),
    IN  p_final_tier_level INT,
    IN  p_final_feedback TEXT,
    IN  p_notes TEXT,
    OUT p_validation_id UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_submission_id UUID;
    v_question_version_id UUID;
    v_student_answer TEXT;
    v_subject_id UUID;
    v_orig_percentage DECIMAL(5, 2);
    v_orig_tier_id UUID;
    v_orig_tier_level INT;
    v_orig_tier_label VARCHAR(100);
    v_final_tier_id UUID;
    v_final_tier_level INT;
    v_final_tier_label VARCHAR(100);
    v_effective_final_pct DECIMAL(5, 2);
    v_effective_final_tier_level INT;
    v_structured_diff JSONB;
BEGIN
    SELECT
        a.submission_id, a.percentage_correct, a.tier_id,
        a.tier_level_snapshot, a.tier_label_snapshot,
        s.question_version_id, s.answer_text, s.subject_id
    INTO
        v_submission_id, v_orig_percentage, v_orig_tier_id,
        v_orig_tier_level, v_orig_tier_label,
        v_question_version_id, v_student_answer, v_subject_id
    FROM llm_analyses a
    JOIN submissions s ON a.submission_id = s.id
    WHERE a.id = p_analysis_id
    FOR UPDATE OF a, s;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'LLM Analysis % not found', p_analysis_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM user_subject_roles
        WHERE user_id = p_lecturer_id AND subject_id = v_subject_id AND role = 'LECTURER'
    ) AND NOT EXISTS (SELECT 1 FROM users WHERE id = p_lecturer_id AND is_superuser = TRUE) THEN
        RAISE EXCEPTION 'User % is not authorized to validate analyses in subject %',
            p_lecturer_id, v_subject_id;
    END IF;

    IF p_status = 'REJECTED' THEN
        v_effective_final_pct := NULL;
        v_effective_final_tier_level := NULL;
        v_final_tier_id := NULL;
        v_final_tier_level := NULL;
        v_final_tier_label := NULL;
    ELSE
        v_effective_final_pct := COALESCE(p_final_percentage, v_orig_percentage);
        v_effective_final_tier_level := COALESCE(p_final_tier_level, v_orig_tier_level);

        SELECT tier_id, tier_level, tier_label
        INTO v_final_tier_id, v_final_tier_level, v_final_tier_label
        FROM fn_resolve_diagnostic_tier(v_subject_id, v_effective_final_tier_level);
    END IF;

    v_structured_diff := jsonb_build_object(
        'percentage', jsonb_build_object(
            'from', v_orig_percentage,
            'to', v_effective_final_pct,
            'modified', (v_orig_percentage IS DISTINCT FROM v_effective_final_pct)
        ),
        'tier', jsonb_build_object(
            'from_level', v_orig_tier_level,
            'to_level', v_final_tier_level,
            'modified', (v_orig_tier_id IS DISTINCT FROM v_final_tier_id)
        )
    );

    p_validation_id := gen_random_uuid();

    INSERT INTO validations (
        id, analysis_id, lecturer_id, status,
        original_percentage, original_tier_id,
        original_tier_level_snapshot, original_tier_label_snapshot,
        final_percentage, final_tier_id,
        final_tier_level_snapshot, final_tier_label_snapshot,
        final_feedback, structured_diff_json, notes, validated_at
    ) VALUES (
        p_validation_id, p_analysis_id, p_lecturer_id, p_status,
        v_orig_percentage, v_orig_tier_id,
        v_orig_tier_level, v_orig_tier_label,
        v_effective_final_pct, v_final_tier_id,
        v_final_tier_level, v_final_tier_label,
        p_final_feedback, v_structured_diff, p_notes, CURRENT_TIMESTAMP
    );

    IF p_status = 'REJECTED' THEN
        UPDATE submissions SET status = 'REJECTED' WHERE id = v_submission_id;
    ELSE
        UPDATE submissions SET status = 'VALIDATED' WHERE id = v_submission_id;

        IF (v_orig_percentage = v_effective_final_pct)
           AND (v_orig_tier_id = v_final_tier_id) THEN
            INSERT INTO few_shot_examples (
                question_version_id, validation_id,
                student_answer_text, verified_analysis_json, is_active
            ) VALUES (
                v_question_version_id, p_validation_id, v_student_answer,
                jsonb_build_object(
                    'percentage_correct', v_effective_final_pct,
                    'tier_level', v_final_tier_level,
                    'tier_label', v_final_tier_label,
                    'feedback', p_final_feedback
                ),
                TRUE
            ) ON CONFLICT (validation_id) DO NOTHING;
        ELSE
            INSERT INTO correction_examples (
                validation_id, question_version_id,
                student_answer_text, llm_analysis_json,
                corrected_analysis_json, structured_diff_json
            ) VALUES (
                p_validation_id, v_question_version_id, v_student_answer,
                jsonb_build_object(
                    'percentage_correct', v_orig_percentage,
                    'tier_level', v_orig_tier_level,
                    'tier_label', v_orig_tier_label
                ),
                jsonb_build_object(
                    'percentage_correct', v_effective_final_pct,
                    'tier_level', v_final_tier_level,
                    'tier_label', v_final_tier_label,
                    'feedback', p_final_feedback
                ),
                v_structured_diff
            ) ON CONFLICT (validation_id) DO NOTHING;
        END IF;
    END IF;

    INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
    VALUES (p_lecturer_id, 'VALIDATE_ANALYSIS', 'validations', p_validation_id,
            jsonb_build_object('status', p_status, 'diff', v_structured_diff));
END;
$$;


-- ============================================================================
-- 17. RAG VECTOR SEARCH
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_search_knowledge_chunks(
    p_subject_id UUID,
    p_query_embedding vector(1536),
    p_topic_id UUID DEFAULT NULL,
    p_match_count INT DEFAULT 5,
    p_similarity_threshold FLOAT DEFAULT 0.0
)
RETURNS TABLE (
    chunk_id UUID, document_id UUID, chunk_index INT,
    content TEXT, token_count INT, metadata_json JSONB, similarity FLOAT
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        kc.id, kc.document_id, kc.chunk_index, kc.content,
        kc.token_count, kc.metadata_json,
        (1.0 - (kc.embedding <=> p_query_embedding))::FLOAT AS similarity
    FROM knowledge_chunks kc
    WHERE kc.subject_id = p_subject_id
      AND kc.embedding IS NOT NULL
      AND (p_topic_id IS NULL OR kc.topic_id = p_topic_id)
      AND (1.0 - (kc.embedding <=> p_query_embedding)) >= p_similarity_threshold
    ORDER BY kc.embedding <=> p_query_embedding ASC
    LIMIT p_match_count;
$$;


-- ============================================================================
-- 18. PROMOTE MISCONCEPTION CANDIDATE
-- ============================================================================

CREATE OR REPLACE PROCEDURE sp_promote_misconception_candidate(
    IN p_misconception_id UUID,
    IN p_lecturer_id UUID,
    IN p_updated_label VARCHAR(255) DEFAULT NULL,
    IN p_updated_description TEXT DEFAULT NULL,
    IN p_default_tier_id UUID DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_subject_id UUID;
    v_source misconception_source_enum;
BEGIN
    SELECT subject_id, source INTO v_subject_id, v_source
    FROM misconceptions WHERE id = p_misconception_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Misconception % does not exist', p_misconception_id;
    END IF;

    IF v_source <> 'LLM_CANDIDATE' THEN
        RAISE EXCEPTION 'Misconception % is not an LLM_CANDIDATE (current source: %)',
            p_misconception_id, v_source;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM user_subject_roles
        WHERE user_id = p_lecturer_id AND subject_id = v_subject_id AND role = 'LECTURER'
    ) AND NOT EXISTS (SELECT 1 FROM users WHERE id = p_lecturer_id AND is_superuser = TRUE) THEN
        RAISE EXCEPTION 'User % is not authorized to promote misconceptions in subject %',
            p_lecturer_id, v_subject_id;
    END IF;

    UPDATE misconceptions
    SET source = 'PROMOTED',
        label = COALESCE(p_updated_label, label),
        description = COALESCE(p_updated_description, description),
        default_tier_id = COALESCE(p_default_tier_id, default_tier_id),
        verified_by = p_lecturer_id,
        verified_at = CURRENT_TIMESTAMP
    WHERE id = p_misconception_id;

    INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata_json)
    VALUES (p_lecturer_id, 'PROMOTE_MISCONCEPTION', 'misconceptions', p_misconception_id,
            jsonb_build_object('promoted_by', p_lecturer_id));
END;
$$;


-- ============================================================================
-- 19. SUBJECT METRICS  (simplified via denormalized subject_id)
-- ============================================================================

DROP FUNCTION IF EXISTS fn_calculate_subject_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION fn_calculate_subject_metrics(
    p_subject_id UUID,
    p_start_date TIMESTAMPTZ DEFAULT NULL,
    p_end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    total_validations          BIGINT,
    rejection_rate             NUMERIC(5, 2),
    validation_acceptance_rate NUMERIC(5, 2),
    score_modification_rate    NUMERIC(5, 2),
    tier_modification_rate     NUMERIC(5, 2),
    exact_agreement_rate       NUMERIC(5, 2),
    score_mae                  NUMERIC(5, 2)
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_total        BIGINT;
    v_non_rejected BIGINT;
BEGIN
    -- [OPTIMIZATION] Single table + index on (subject_id, validated_at)
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE v.status <> 'REJECTED')
    INTO v_total, v_non_rejected
    FROM validations v
    WHERE v.subject_id = p_subject_id
      AND (p_start_date IS NULL OR v.validated_at >= p_start_date)
      AND (p_end_date   IS NULL OR v.validated_at <= p_end_date);

    RETURN QUERY
    SELECT
        v_total,
        ROUND((COUNT(v.id) FILTER (WHERE v.status = 'REJECTED') * 100.0
             / NULLIF(v_total, 0))::numeric, 2) AS rejection_rate,
        ROUND((COUNT(v.id) FILTER (WHERE v.status = 'ACCEPTED') * 100.0
             / NULLIF(v_total, 0))::numeric, 2) AS validation_acceptance_rate,
        ROUND((COUNT(v.id) FILTER (
                WHERE v.status <> 'REJECTED' AND v.is_score_modified = TRUE
             ) * 100.0 / NULLIF(v_non_rejected, 0))::numeric, 2) AS score_modification_rate,
        ROUND((COUNT(v.id) FILTER (
                WHERE v.status <> 'REJECTED' AND v.is_tier_modified = TRUE
             ) * 100.0 / NULLIF(v_non_rejected, 0))::numeric, 2) AS tier_modification_rate,
        ROUND((COUNT(v.id) FILTER (
                WHERE v.status <> 'REJECTED'
                  AND v.is_score_modified = FALSE AND v.is_tier_modified = FALSE
             ) * 100.0 / NULLIF(v_non_rejected, 0))::numeric, 2) AS exact_agreement_rate,
        ROUND(AVG(ABS(v.final_percentage - v.original_percentage))
                FILTER (WHERE v.status <> 'REJECTED')::numeric, 2) AS score_mae
    FROM validations v
    WHERE v.subject_id = p_subject_id
      AND (p_start_date IS NULL OR v.validated_at >= p_start_date)
      AND (p_end_date   IS NULL OR v.validated_at <= p_end_date);
END;
$$;


-- ============================================================================
-- 20. MATERIALIZED VIEW: STUDENT QUESTION MASTERY  (renamed)
-- ============================================================================

CREATE MATERIALIZED VIEW mv_student_question_mastery AS
SELECT
    v.id                     AS validation_id,
    s.student_id,
    s.subject_id,
    qs.topic_id,
    qv.question_id,
    s.question_version_id,
    v.final_percentage,
    v.final_tier_level_snapshot AS tier_level,
    v.final_tier_label_snapshot AS tier_label,
    v.is_score_modified,
    v.is_tier_modified,
    v.validated_at
FROM validations v
JOIN submissions s ON v.analysis_id = (
    SELECT id FROM llm_analyses WHERE submission_id = s.id AND is_current = TRUE LIMIT 1
)
JOIN question_versions qv ON s.question_version_id = qv.id
JOIN questions q ON qv.question_id = q.id
JOIN question_sets qs ON q.question_set_id = qs.id
WHERE v.status IN ('ACCEPTED', 'EDITED');

-- NOTE: the above join structure is illustrative; see below for the exact form.

DROP MATERIALIZED VIEW IF EXISTS mv_student_question_mastery;

CREATE MATERIALIZED VIEW mv_student_question_mastery AS
SELECT
    v.id                     AS validation_id,
    s.student_id,
    s.subject_id,
    qs.topic_id,
    qv.question_id,
    s.question_version_id,
    v.final_percentage,
    v.final_tier_level_snapshot AS tier_level,
    v.final_tier_label_snapshot AS tier_label,
    v.is_score_modified,
    v.is_tier_modified,
    v.validated_at
FROM validations v
JOIN llm_analyses a ON v.analysis_id = a.id
JOIN submissions s ON a.submission_id = s.id
JOIN question_versions qv ON s.question_version_id = qv.id
JOIN questions q ON qv.question_id = q.id
JOIN question_sets qs ON q.question_set_id = qs.id
WHERE v.status IN ('ACCEPTED', 'EDITED');

CREATE UNIQUE INDEX uq_mv_student_question_mastery
    ON mv_student_question_mastery (validation_id);
CREATE INDEX idx_mv_sqm_student_subject
    ON mv_student_question_mastery (student_id, subject_id);
CREATE INDEX idx_mv_sqm_subject_topic
    ON mv_student_question_mastery (subject_id, topic_id);


-- ============================================================================
-- 21. REFRESH CONCEPT MASTERY VIEW
-- ============================================================================

CREATE OR REPLACE PROCEDURE sp_refresh_question_mastery_view()
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW mv_student_question_mastery;
END;
$$;


-- ============================================================================
-- 22. SEED DATA
-- ============================================================================

INSERT INTO diagnostic_tiers (id, subject_id, level, label, description) VALUES
    ('018e3d60-0001-7000-8000-000000000001', NULL, 1, 'No Understanding',
     'Irrelevant, blank, or fundamentally incorrect reasoning.'),
    ('018e3d60-0002-7000-8000-000000000002', NULL, 2, 'Misconception',
     'Persistent, systematic flawed mental model.'),
    ('018e3d60-0003-7000-8000-000000000003', NULL, 3, 'Partial Understanding',
     'Valid conceptual elements present but incomplete or accompanied by minor flaws.'),
    ('018e3d60-0004-7000-8000-000000000004', NULL, 4, 'Sound Understanding',
     'Scientifically accurate, well-justified conceptual grasp.')
ON CONFLICT (subject_id, level) DO NOTHING;


-- ============================================================================
-- END OF FILE — v2.6
-- ============================================================================