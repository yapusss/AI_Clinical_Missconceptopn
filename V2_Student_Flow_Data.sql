-- ============================================================================
-- AI-Clinical Misconception - Student Flow sample data (demo / walkthrough)
--
-- What this is
--   Data-only export of the reference student-flow state used to verify the flow
--   end to end: demo accounts, 2 subjects, 5 question sets (1 draft, 3 published
--   single-question sets, 1 published 3-question set) and 10 submissions spread
--   across attempts, with their audit-log entries.
--
-- Requires
--   V2_Full_Script.sql (schema). Import that FIRST, always.
--
-- How to apply
--   docker cp V2_Student_Flow_Data.sql postgres:/tmp/
--   docker exec postgres psql -v ON_ERROR_STOP=1 -U appuser -d appdb \
--     -f /tmp/V2_Student_Flow_Data.sql
--
-- Safe to re-run: every INSERT is ON CONFLICT DO NOTHING.
--
-- Demo logins (see backend/api/management/commands/seed_demo_data.py)
--   admin@acm.local | demo@acm.local | lecturer@acm.local | student@acm.local
--   password: demo12345
--
-- Excluded on purpose: auth_tokens and django_* tables (session + migration state).
-- ============================================================================

--
-- PostgreSQL database dump
--

-- Dumped from database version 16.15 (Debian 16.15-1.pgdg12+2)
-- Dumped by pg_dump version 16.15 (Debian 16.15-1.pgdg12+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
-- pg_dump empties the search_path, but V2's trigger/function bodies reference tables
-- unqualified (e.g. trg_set_submission_subject_id -> question_versions), so restoring
-- with an empty search_path makes every submissions INSERT fail inside the trigger.
SELECT pg_catalog.set_config('search_path', 'public', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: subjects; Type: TABLE DATA; Schema: public; Owner: appuser
--

INSERT INTO public.subjects VALUES ('68f1ccae-70b2-40a7-bddc-5ae457fa4d6a', 'Biology', 'biology', 'Cell biology, genetics and physiology.', true, NULL, '2026-09-19 16:53:12.520772+00', '2026-09-19 16:53:12.520779+00') ON CONFLICT DO NOTHING;
INSERT INTO public.subjects VALUES ('cfc7f58c-eeb8-451e-95e7-14c721e9574b', 'Physics', 'physics', 'Mechanics, electromagnetism and thermodynamics.', true, NULL, '2026-09-19 16:53:12.526357+00', '2026-09-19 16:53:12.526362+00') ON CONFLICT DO NOTHING;

--
-- Data for Name: topics; Type: TABLE DATA; Schema: public; Owner: appuser
--

--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: appuser
--

INSERT INTO public.users VALUES ('8e289222-3585-486b-a985-5631afb32015', 'demo@acm.local', 'Demo User', 'pbkdf2_sha256$1500000$AX2CWc6aZTN5vg4sk3BE8w$KKnbxbuPYoqiwDh+r5K6blnRYqgmWwlFILrVPoIAfRM=', true, false, '2026-09-19 16:53:13.031679+00', '2026-09-19 16:53:13.031687+00') ON CONFLICT DO NOTHING;
INSERT INTO public.users VALUES ('7b4a606d-621b-4b7c-b77d-2924b7e6457c', 'admin@acm.local', 'Admin User', 'pbkdf2_sha256$1500000$M2Z2QA1GxKmP9DR2Y08EN4$Xl55/nLQ9pSEd7GDhaMqw1+QkOWiKeERhyoUhlD3k3k=', true, true, '2026-09-19 16:53:13.514042+00', '2026-09-19 16:53:13.514049+00') ON CONFLICT DO NOTHING;
INSERT INTO public.users VALUES ('2dc8a133-dced-466c-972c-2e703da73c55', 'lecturer@acm.local', 'Lecturer Demo', 'pbkdf2_sha256$1500000$o7NnaWJ05SQ1hSVV20pQ0s$2vnJKl3/rf2phJx1GA7dkF1k1oVdEnGGD6OtuYdxufA=', true, false, '2026-09-19 16:53:14.001512+00', '2026-09-19 16:53:14.001519+00') ON CONFLICT DO NOTHING;
INSERT INTO public.users VALUES ('3339aeeb-14a9-4799-8d73-8f1c2552c147', 'student@acm.local', 'Student Demo', 'pbkdf2_sha256$1500000$ER8mQ5KuaQAhFqVL3gIrQY$aLFAYoSecZjZ2/Qc0GI0HMmPb2caHUPK/6qLYO5Q8Yo=', true, false, '2026-09-19 16:53:14.523313+00', '2026-09-19 16:53:14.523321+00') ON CONFLICT DO NOTHING;

--
-- Data for Name: question_sets; Type: TABLE DATA; Schema: public; Owner: appuser
--

INSERT INTO public.question_sets VALUES ('7c4b4ada-6197-48fd-8636-e29f35027f82', '68f1ccae-70b2-40a7-bddc-5ae457fa4d6a', NULL, '2dc8a133-dced-466c-972c-2e703da73c55', 'FIS-NEWTON-01', 'Hukum II Newton pada Lift', 'Tes awal', true, '2026-09-19 16:54:02.295007+00', '2026-09-19 16:54:02.29502+00') ON CONFLICT DO NOTHING;
INSERT INTO public.question_sets VALUES ('873fb355-cf76-4d54-b567-cb5bdeee357f', '68f1ccae-70b2-40a7-bddc-5ae457fa4d6a', NULL, '2dc8a133-dced-466c-972c-2e703da73c55', 'FIS-NEWTON-02', 'Gaya Gesek pada Bidang Miring', 'Uji alur mahasiswa', true, '2026-09-19 17:25:50.012045+00', '2026-09-19 17:25:50.012052+00') ON CONFLICT DO NOTHING;
INSERT INTO public.question_sets VALUES ('b34992c4-002c-4a3d-8272-091ab835596a', '68f1ccae-70b2-40a7-bddc-5ae457fa4d6a', NULL, '2dc8a133-dced-466c-972c-2e703da73c55', 'FIS-DRAFT-01', 'Draft Soal Belum Publik', 'uji', true, '2026-09-19 17:27:04.427892+00', '2026-09-19 17:27:04.4279+00') ON CONFLICT DO NOTHING;
INSERT INTO public.question_sets VALUES ('a76c5222-6346-44e0-8b15-770f19d056e0', 'cfc7f58c-eeb8-451e-95e7-14c721e9574b', NULL, '2dc8a133-dced-466c-972c-2e703da73c55', 'FIS-OPTIK-01', 'Pembiasan Cahaya pada Lensa', 'uji filter', true, '2026-09-19 18:09:07.25718+00', '2026-09-19 18:09:07.257185+00') ON CONFLICT DO NOTHING;
INSERT INTO public.question_sets VALUES ('990eb892-a2d9-4f4a-a01d-8a2047db6f54', '68f1ccae-70b2-40a7-bddc-5ae457fa4d6a', NULL, '2dc8a133-dced-466c-972c-2e703da73c55', 'FIS-NEWTON-03', 'Set Dua Pertanyaan (uji)', 'Uji multi-pertanyaan', true, '2026-09-19 18:14:33.672818+00', '2026-09-19 18:14:33.672818+00') ON CONFLICT DO NOTHING;

--
-- Data for Name: questions; Type: TABLE DATA; Schema: public; Owner: appuser
--

INSERT INTO public.questions VALUES ('e35ff88b-2428-44cc-9fa9-8e50c4c2593a', '7c4b4ada-6197-48fd-8636-e29f35027f82', 1, '2026-09-19 16:54:02.296705+00') ON CONFLICT DO NOTHING;
INSERT INTO public.questions VALUES ('032a2739-c80f-464e-8a19-c249326d17da', '873fb355-cf76-4d54-b567-cb5bdeee357f', 1, '2026-09-19 17:25:50.01568+00') ON CONFLICT DO NOTHING;
INSERT INTO public.questions VALUES ('ad423208-f925-4d29-aa36-8d737e121e53', 'b34992c4-002c-4a3d-8272-091ab835596a', 1, '2026-09-19 17:27:04.429465+00') ON CONFLICT DO NOTHING;
INSERT INTO public.questions VALUES ('2da4ee0d-8455-450e-a265-ce91c730a628', 'a76c5222-6346-44e0-8b15-770f19d056e0', 1, '2026-09-19 18:09:07.258776+00') ON CONFLICT DO NOTHING;
INSERT INTO public.questions VALUES ('f973ab81-9656-4a21-b057-f6ed2dfecf61', '990eb892-a2d9-4f4a-a01d-8a2047db6f54', 1, '2026-09-19 18:14:33.672818+00') ON CONFLICT DO NOTHING;
INSERT INTO public.questions VALUES ('411246e2-43df-490f-bc02-8fe83c791c1a', '990eb892-a2d9-4f4a-a01d-8a2047db6f54', 2, '2026-09-19 18:14:33.672818+00') ON CONFLICT DO NOTHING;
INSERT INTO public.questions VALUES ('5b62e21a-bca9-48be-8dc8-5a0561b395a3', '990eb892-a2d9-4f4a-a01d-8a2047db6f54', 3, '2026-09-19 18:29:41.622628+00') ON CONFLICT DO NOTHING;

--
-- Data for Name: question_versions; Type: TABLE DATA; Schema: public; Owner: appuser
--

INSERT INTO public.question_versions VALUES ('82d408b9-a2da-461f-9573-d614e8f33758', 'e35ff88b-2428-44cc-9fa9-8e50c4c2593a', 1, 'Sebuah lift dipercepat ke atas. Bandingkan gaya normal dan gaya berat penumpang. Jelaskan alasannya.', 'Gaya normal lebih besar dari gaya berat karena lift dipercepat ke atas (N = m(g+a)).', true, '2dc8a133-dced-466c-972c-2e703da73c55', '2026-09-19 16:54:02.297786+00') ON CONFLICT DO NOTHING;
INSERT INTO public.question_versions VALUES ('7b3709c0-d069-4be6-8f61-79315f7a633a', '032a2739-c80f-464e-8a19-c249326d17da', 1, 'Sebuah balok diam di bidang miring kasar. Jelaskan mengapa balok tidak meluncur ke bawah.', 'Gaya gesek statis menyeimbangkan komponen gaya berat sejajar bidang (f_s = m g sin theta).', true, '2dc8a133-dced-466c-972c-2e703da73c55', '2026-09-19 17:25:50.016719+00') ON CONFLICT DO NOTHING;
INSERT INTO public.question_versions VALUES ('36183321-c373-4132-9387-b62bf58e3504', 'ad423208-f925-4d29-aa36-8d737e121e53', 1, 'Draft prompt?', 'referensi', false, '2dc8a133-dced-466c-972c-2e703da73c55', '2026-09-19 17:27:04.430361+00') ON CONFLICT DO NOTHING;
INSERT INTO public.question_versions VALUES ('4efe3571-01fd-484e-af1a-0cfb2e818566', '2da4ee0d-8455-450e-a265-ce91c730a628', 1, 'Mengapa bayangan pada lensa cembung dapat bersifat nyata? Jelaskan.', 'Karena berkas sinar bias benar-benar berpotongan di ruang nyata di belakang lensa.', true, '2dc8a133-dced-466c-972c-2e703da73c55', '2026-09-19 18:09:07.259579+00') ON CONFLICT DO NOTHING;
INSERT INTO public.question_versions VALUES ('c7ba572b-b504-4b37-a52a-52f10c3d62dd', 'f973ab81-9656-4a21-b057-f6ed2dfecf61', 1, 'Pertanyaan 1: Sebuah balok diam di atas meja. Apakah ada gaya yang bekerja padanya? Jelaskan.', 'Ada gaya berat dan gaya normal yang saling meniadakan.', true, '2dc8a133-dced-466c-972c-2e703da73c55', '2026-09-19 18:14:33.672818+00') ON CONFLICT DO NOTHING;
INSERT INTO public.question_versions VALUES ('49cb529e-71eb-4522-884b-1d5189a03f9b', '411246e2-43df-490f-bc02-8fe83c791c1a', 1, 'Pertanyaan 2: Gaya 10 N bekerja pada benda 2 kg. Hitung percepatannya dan jelaskan.', 'a = F/m = 5 m/s^2.', true, '2dc8a133-dced-466c-972c-2e703da73c55', '2026-09-19 18:14:33.672818+00') ON CONFLICT DO NOTHING;
INSERT INTO public.question_versions VALUES ('75d4b831-876e-488e-b514-d8fae676c324', 'f973ab81-9656-4a21-b057-f6ed2dfecf61', 2, 'versi 2', 'x', false, '2dc8a133-dced-466c-972c-2e703da73c55', '2026-09-19 18:14:53.193834+00') ON CONFLICT DO NOTHING;
INSERT INTO public.question_versions VALUES ('af9a646c-2a8c-4851-a973-7a5abd1e8f37', '5b62e21a-bca9-48be-8dc8-5a0561b395a3', 1, 'Pertanyaan 3: Jelaskan perbedaan massa dan berat sebuah benda.', 'Massa adalah jumlah materi (kg), berat adalah gaya gravitasi pada massa (N).', true, '2dc8a133-dced-466c-972c-2e703da73c55', '2026-09-19 18:29:41.622628+00') ON CONFLICT DO NOTHING;

--
-- Data for Name: submissions; Type: TABLE DATA; Schema: public; Owner: appuser
--

INSERT INTO public.submissions VALUES ('2f75d013-dbff-43bb-9cff-187e5b4ff03a', '3339aeeb-14a9-4799-8d73-8f1c2552c147', '82d408b9-a2da-461f-9573-d614e8f33758', '68f1ccae-70b2-40a7-bddc-5ae457fa4d6a', 'Gaya normal lebih besar dari gaya berat karena lift dipercepat ke atas.', 1, 'SUBMITTED', '2026-09-19 17:14:02.055811+00') ON CONFLICT DO NOTHING;
INSERT INTO public.submissions VALUES ('0d5d327e-ac0c-429d-b0d4-06c084865d2b', '3339aeeb-14a9-4799-8d73-8f1c2552c147', '82d408b9-a2da-461f-9573-d614e8f33758', '68f1ccae-70b2-40a7-bddc-5ae457fa4d6a', 'Jawaban kedua: N lebih besar dari W.', 2, 'SUBMITTED', '2026-09-19 17:14:02.660602+00') ON CONFLICT DO NOTHING;
INSERT INTO public.submissions VALUES ('5a7410f5-0ac5-44ad-a1b1-0604c506be68', '3339aeeb-14a9-4799-8d73-8f1c2552c147', '82d408b9-a2da-461f-9573-d614e8f33758', '68f1ccae-70b2-40a7-bddc-5ae457fa4d6a', 'Percobaan kedua: gaya normal lebih besar dari gaya berat (N > W).', 3, 'SUBMITTED', '2026-09-19 17:24:53.024792+00') ON CONFLICT DO NOTHING;
INSERT INTO public.submissions VALUES ('8da4ae35-696a-4d5d-8640-0bf1a2104d52', '3339aeeb-14a9-4799-8d73-8f1c2552c147', '7b3709c0-d069-4be6-8f61-79315f7a633a', '68f1ccae-70b2-40a7-bddc-5ae457fa4d6a', 'Balok tidak meluncur karena gaya gesek statis menyeimbangkan komponen berat sejajar bidang.', 1, 'SUBMITTED', '2026-09-19 17:26:18.342322+00') ON CONFLICT DO NOTHING;
INSERT INTO public.submissions VALUES ('14d16224-c2f4-4ec0-89b8-a176a4028ac5', '3339aeeb-14a9-4799-8d73-8f1c2552c147', '7b3709c0-d069-4be6-8f61-79315f7a633a', '68f1ccae-70b2-40a7-bddc-5ae457fa4d6a', 'Karena nyangkut', 2, 'SUBMITTED', '2026-09-19 17:48:18.29527+00') ON CONFLICT DO NOTHING;
INSERT INTO public.submissions VALUES ('5aa0aef6-d038-416d-be13-baa7af2eff49', '3339aeeb-14a9-4799-8d73-8f1c2552c147', '4efe3571-01fd-484e-af1a-0cfb2e818566', 'cfc7f58c-eeb8-451e-95e7-14c721e9574b', 'Bayangan nyata terbentuk karena sinar-sinar bias berpotongan di belakang lensa.', 1, 'SUBMITTED', '2026-09-19 18:09:08.643977+00') ON CONFLICT DO NOTHING;
INSERT INTO public.submissions VALUES ('dabe383c-4086-4cc7-b23b-9a9d4ba6f52c', '3339aeeb-14a9-4799-8d73-8f1c2552c147', '49cb529e-71eb-4522-884b-1d5189a03f9b', '68f1ccae-70b2-40a7-bddc-5ae457fa4d6a', 'a = F/m = 10/2 = 5 m/s^2, arah searah gaya.', 1, 'SUBMITTED', '2026-09-19 18:14:52.307937+00') ON CONFLICT DO NOTHING;
INSERT INTO public.submissions VALUES ('3799b006-82ab-466a-b510-9b0093082d67', '3339aeeb-14a9-4799-8d73-8f1c2552c147', 'c7ba572b-b504-4b37-a52a-52f10c3d62dd', '68f1ccae-70b2-40a7-bddc-5ae457fa4d6a', 'Balok diam: gaya berat dan gaya normal sama besar, resultan nol.', 1, 'SUBMITTED', '2026-09-19 18:15:18.073843+00') ON CONFLICT DO NOTHING;
INSERT INTO public.submissions VALUES ('0837199e-ea7f-4791-ac54-c13cc4970936', '3339aeeb-14a9-4799-8d73-8f1c2552c147', '49cb529e-71eb-4522-884b-1d5189a03f9b', '68f1ccae-70b2-40a7-bddc-5ae457fa4d6a', 'Percepatan 5 m/s^2 (perbaikan penjelasan).', 2, 'SUBMITTED', '2026-09-19 18:14:52.569584+00') ON CONFLICT DO NOTHING;
INSERT INTO public.submissions VALUES ('17312409-cb42-4a78-a7c8-52cebe349422', '3339aeeb-14a9-4799-8d73-8f1c2552c147', '4efe3571-01fd-484e-af1a-0cfb2e818566', 'cfc7f58c-eeb8-451e-95e7-14c721e9574b', 'Because of you', 2, 'SUBMITTED', '2026-09-19 18:38:08.523732+00') ON CONFLICT DO NOTHING;

--
-- Data for Name: anomaly_flags; Type: TABLE DATA; Schema: public; Owner: appuser
--

--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: appuser
--

INSERT INTO public.audit_logs VALUES (1, '2dc8a133-dced-466c-972c-2e703da73c55', 'PUBLISH_QUESTION_VERSION', 'question_versions', '82d408b9-a2da-461f-9573-d614e8f33758', '{"total_indicators_weight": 1.0000}', '2026-09-19 16:54:02.295206+00') ON CONFLICT DO NOTHING;
INSERT INTO public.audit_logs VALUES (2, '3339aeeb-14a9-4799-8d73-8f1c2552c147', 'SUBMIT_ANSWER', 'submissions', '2f75d013-dbff-43bb-9cff-187e5b4ff03a', '{"attempt_no": 1}', '2026-09-19 17:14:02.055811+00') ON CONFLICT DO NOTHING;
INSERT INTO public.audit_logs VALUES (3, '3339aeeb-14a9-4799-8d73-8f1c2552c147', 'SUBMIT_ANSWER', 'submissions', '0d5d327e-ac0c-429d-b0d4-06c084865d2b', '{"attempt_no": 2}', '2026-09-19 17:14:02.660602+00') ON CONFLICT DO NOTHING;
INSERT INTO public.audit_logs VALUES (4, '3339aeeb-14a9-4799-8d73-8f1c2552c147', 'SUBMIT_ANSWER', 'submissions', '5a7410f5-0ac5-44ad-a1b1-0604c506be68', '{"attempt_no": 3}', '2026-09-19 17:24:53.024792+00') ON CONFLICT DO NOTHING;
INSERT INTO public.audit_logs VALUES (5, '2dc8a133-dced-466c-972c-2e703da73c55', 'PUBLISH_QUESTION_VERSION', 'question_versions', '7b3709c0-d069-4be6-8f61-79315f7a633a', '{"total_indicators_weight": 1.0000}', '2026-09-19 17:25:50.011835+00') ON CONFLICT DO NOTHING;
INSERT INTO public.audit_logs VALUES (6, '3339aeeb-14a9-4799-8d73-8f1c2552c147', 'SUBMIT_ANSWER', 'submissions', '8da4ae35-696a-4d5d-8640-0bf1a2104d52', '{"attempt_no": 1}', '2026-09-19 17:26:18.342322+00') ON CONFLICT DO NOTHING;
INSERT INTO public.audit_logs VALUES (7, '3339aeeb-14a9-4799-8d73-8f1c2552c147', 'SUBMIT_ANSWER', 'submissions', '14d16224-c2f4-4ec0-89b8-a176a4028ac5', '{"attempt_no": 2}', '2026-09-19 17:48:18.29527+00') ON CONFLICT DO NOTHING;
INSERT INTO public.audit_logs VALUES (8, '2dc8a133-dced-466c-972c-2e703da73c55', 'PUBLISH_QUESTION_VERSION', 'question_versions', '4efe3571-01fd-484e-af1a-0cfb2e818566', '{"total_indicators_weight": 1.0000}', '2026-09-19 18:09:07.257147+00') ON CONFLICT DO NOTHING;
INSERT INTO public.audit_logs VALUES (9, '3339aeeb-14a9-4799-8d73-8f1c2552c147', 'SUBMIT_ANSWER', 'submissions', '5aa0aef6-d038-416d-be13-baa7af2eff49', '{"attempt_no": 1}', '2026-09-19 18:09:08.643977+00') ON CONFLICT DO NOTHING;
INSERT INTO public.audit_logs VALUES (10, '2dc8a133-dced-466c-972c-2e703da73c55', 'PUBLISH_QUESTION_VERSION', 'question_versions', 'c7ba572b-b504-4b37-a52a-52f10c3d62dd', '{"total_indicators_weight": 1.0000}', '2026-09-19 18:14:33.672818+00') ON CONFLICT DO NOTHING;
INSERT INTO public.audit_logs VALUES (11, '2dc8a133-dced-466c-972c-2e703da73c55', 'PUBLISH_QUESTION_VERSION', 'question_versions', '49cb529e-71eb-4522-884b-1d5189a03f9b', '{"total_indicators_weight": 1.0000}', '2026-09-19 18:14:33.672818+00') ON CONFLICT DO NOTHING;
INSERT INTO public.audit_logs VALUES (12, '3339aeeb-14a9-4799-8d73-8f1c2552c147', 'SUBMIT_ANSWER', 'submissions', 'dabe383c-4086-4cc7-b23b-9a9d4ba6f52c', '{"attempt_no": 1}', '2026-09-19 18:14:52.307937+00') ON CONFLICT DO NOTHING;
INSERT INTO public.audit_logs VALUES (13, '3339aeeb-14a9-4799-8d73-8f1c2552c147', 'SUBMIT_ANSWER', 'submissions', '0837199e-ea7f-4791-ac54-c13cc4970936', '{"attempt_no": 2}', '2026-09-19 18:14:52.569584+00') ON CONFLICT DO NOTHING;
INSERT INTO public.audit_logs VALUES (14, '3339aeeb-14a9-4799-8d73-8f1c2552c147', 'SUBMIT_ANSWER', 'submissions', '3799b006-82ab-466a-b510-9b0093082d67', '{"attempt_no": 1}', '2026-09-19 18:15:18.073843+00') ON CONFLICT DO NOTHING;
INSERT INTO public.audit_logs VALUES (15, '2dc8a133-dced-466c-972c-2e703da73c55', 'PUBLISH_QUESTION_VERSION', 'question_versions', 'af9a646c-2a8c-4851-a973-7a5abd1e8f37', '{"total_indicators_weight": 1.0000}', '2026-09-19 18:29:41.622628+00') ON CONFLICT DO NOTHING;
INSERT INTO public.audit_logs VALUES (16, '3339aeeb-14a9-4799-8d73-8f1c2552c147', 'SUBMIT_ANSWER', 'submissions', '17312409-cb42-4a78-a7c8-52cebe349422', '{"attempt_no": 2}', '2026-09-19 18:38:08.523732+00') ON CONFLICT DO NOTHING;

--
-- Data for Name: concept_indicators; Type: TABLE DATA; Schema: public; Owner: appuser
--

INSERT INTO public.concept_indicators VALUES ('c5112533-b32a-466d-9e44-b2ccd74dc1e3', '82d408b9-a2da-461f-9573-d614e8f33758', 'Ketepatan Konsep Hukum II Newton', 'Hubungan gaya, massa, percepatan', 0.5000, 1, '2026-09-19 16:54:02.299076+00') ON CONFLICT DO NOTHING;
INSERT INTO public.concept_indicators VALUES ('efe6c737-7cd7-4011-a989-c1f1a95620ab', '82d408b9-a2da-461f-9573-d614e8f33758', 'Konsistensi Penalaran', 'Logis tanpa kontradiksi', 0.5000, 2, '2026-09-19 16:54:02.30111+00') ON CONFLICT DO NOTHING;
INSERT INTO public.concept_indicators VALUES ('f9247e34-2210-46f1-b186-be2dc888f765', '7b3709c0-d069-4be6-8f61-79315f7a633a', 'Ketepatan Konsep Gaya Gesek', 'Identifikasi gaya gesek statis', 0.5000, 1, '2026-09-19 17:25:50.017965+00') ON CONFLICT DO NOTHING;
INSERT INTO public.concept_indicators VALUES ('332f889b-4ae4-42ca-ab40-95e1eb9ef6ed', '7b3709c0-d069-4be6-8f61-79315f7a633a', 'Konsistensi Penalaran', 'Logis tanpa kontradiksi', 0.5000, 2, '2026-09-19 17:25:50.020855+00') ON CONFLICT DO NOTHING;
INSERT INTO public.concept_indicators VALUES ('23379578-c208-4a29-91b3-366225fed24d', '36183321-c373-4132-9387-b62bf58e3504', 'Indikator', 'x', 1.0000, 1, '2026-09-19 17:27:04.431371+00') ON CONFLICT DO NOTHING;
INSERT INTO public.concept_indicators VALUES ('be0a6be2-5617-4407-9a0a-c93b36c114f4', '4efe3571-01fd-484e-af1a-0cfb2e818566', 'Konsep Pembiasan', 'x', 1.0000, 1, '2026-09-19 18:09:07.260627+00') ON CONFLICT DO NOTHING;
INSERT INTO public.concept_indicators VALUES ('9b4fa07c-a510-43db-9352-0f5fd411cb9a', 'c7ba572b-b504-4b37-a52a-52f10c3d62dd', 'Konsep Gaya', '', 0.6000, 1, '2026-09-19 18:14:33.672818+00') ON CONFLICT DO NOTHING;
INSERT INTO public.concept_indicators VALUES ('2d39498f-0407-4637-b406-a898ec3e1575', 'c7ba572b-b504-4b37-a52a-52f10c3d62dd', 'Penalaran', '', 0.4000, 2, '2026-09-19 18:14:33.672818+00') ON CONFLICT DO NOTHING;
INSERT INTO public.concept_indicators VALUES ('bdcf68b4-996d-49a1-a3a7-fb718a384fdb', '49cb529e-71eb-4522-884b-1d5189a03f9b', 'Konsep Hukum II Newton', '', 1.0000, 1, '2026-09-19 18:14:33.672818+00') ON CONFLICT DO NOTHING;
INSERT INTO public.concept_indicators VALUES ('6d056388-d189-491f-bc1a-d9749581657b', '75d4b831-876e-488e-b514-d8fae676c324', 'A', NULL, 0.3000, 1, '2026-09-19 18:14:53.193834+00') ON CONFLICT DO NOTHING;
INSERT INTO public.concept_indicators VALUES ('2ca7e901-c63e-433a-beba-bb270e5a502b', '75d4b831-876e-488e-b514-d8fae676c324', 'B', NULL, 0.3000, 2, '2026-09-19 18:14:53.193834+00') ON CONFLICT DO NOTHING;
INSERT INTO public.concept_indicators VALUES ('6765269d-e354-494b-b6ea-f5cd2e15aad5', 'af9a646c-2a8c-4851-a973-7a5abd1e8f37', 'Konsep Massa vs Berat', '', 1.0000, 1, '2026-09-19 18:29:41.622628+00') ON CONFLICT DO NOTHING;

--
-- Data for Name: diagnostic_tiers; Type: TABLE DATA; Schema: public; Owner: appuser
--

INSERT INTO public.diagnostic_tiers VALUES ('018e3d60-0001-7000-8000-000000000001', NULL, 1, 'No Understanding', 'Irrelevant, blank, or fundamentally incorrect reasoning.', true, '2026-09-19 16:51:15.187968+00') ON CONFLICT DO NOTHING;
INSERT INTO public.diagnostic_tiers VALUES ('018e3d60-0002-7000-8000-000000000002', NULL, 2, 'Misconception', 'Persistent, systematic flawed mental model.', true, '2026-09-19 16:51:15.187968+00') ON CONFLICT DO NOTHING;
INSERT INTO public.diagnostic_tiers VALUES ('018e3d60-0003-7000-8000-000000000003', NULL, 3, 'Partial Understanding', 'Valid conceptual elements present but incomplete or accompanied by minor flaws.', true, '2026-09-19 16:51:15.187968+00') ON CONFLICT DO NOTHING;
INSERT INTO public.diagnostic_tiers VALUES ('018e3d60-0004-7000-8000-000000000004', NULL, 4, 'Sound Understanding', 'Scientifically accurate, well-justified conceptual grasp.', true, '2026-09-19 16:51:15.187968+00') ON CONFLICT DO NOTHING;

--
-- Data for Name: llm_analyses; Type: TABLE DATA; Schema: public; Owner: appuser
--

--
-- Data for Name: validations; Type: TABLE DATA; Schema: public; Owner: appuser
--

--
-- Data for Name: correction_examples; Type: TABLE DATA; Schema: public; Owner: appuser
--

--
-- Data for Name: export_jobs; Type: TABLE DATA; Schema: public; Owner: appuser
--

--
-- Data for Name: few_shot_examples; Type: TABLE DATA; Schema: public; Owner: appuser
--

--
-- Data for Name: knowledge_documents; Type: TABLE DATA; Schema: public; Owner: appuser
--

--
-- Data for Name: knowledge_chunks; Type: TABLE DATA; Schema: public; Owner: appuser
--

--
-- Data for Name: llm_models; Type: TABLE DATA; Schema: public; Owner: appuser
--

--
-- Data for Name: misconceptions; Type: TABLE DATA; Schema: public; Owner: appuser
--

--
-- Data for Name: prompt_templates; Type: TABLE DATA; Schema: public; Owner: appuser
--

--
-- Data for Name: question_version_misconceptions; Type: TABLE DATA; Schema: public; Owner: appuser
--

--
-- Data for Name: user_subject_roles; Type: TABLE DATA; Schema: public; Owner: appuser
--

INSERT INTO public.user_subject_roles VALUES (1, '2dc8a133-dced-466c-972c-2e703da73c55', '68f1ccae-70b2-40a7-bddc-5ae457fa4d6a', 'LECTURER', '2026-09-19 16:53:14.007244+00') ON CONFLICT DO NOTHING;
INSERT INTO public.user_subject_roles VALUES (2, '2dc8a133-dced-466c-972c-2e703da73c55', 'cfc7f58c-eeb8-451e-95e7-14c721e9574b', 'LECTURER', '2026-09-19 16:53:14.011281+00') ON CONFLICT DO NOTHING;
INSERT INTO public.user_subject_roles VALUES (3, '3339aeeb-14a9-4799-8d73-8f1c2552c147', '68f1ccae-70b2-40a7-bddc-5ae457fa4d6a', 'STUDENT', '2026-09-19 16:53:14.529558+00') ON CONFLICT DO NOTHING;
INSERT INTO public.user_subject_roles VALUES (4, '3339aeeb-14a9-4799-8d73-8f1c2552c147', 'cfc7f58c-eeb8-451e-95e7-14c721e9574b', 'STUDENT', '2026-09-19 16:53:14.534534+00') ON CONFLICT DO NOTHING;

--
-- Name: audit_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: appuser
--

SELECT pg_catalog.setval('public.audit_logs_id_seq', 16, true);

--
-- Name: correction_examples_id_seq; Type: SEQUENCE SET; Schema: public; Owner: appuser
--

SELECT pg_catalog.setval('public.correction_examples_id_seq', 1, false);

--
-- Name: few_shot_examples_id_seq; Type: SEQUENCE SET; Schema: public; Owner: appuser
--

SELECT pg_catalog.setval('public.few_shot_examples_id_seq', 1, false);

--
-- Name: user_subject_roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: appuser
--

SELECT pg_catalog.setval('public.user_subject_roles_id_seq', 4, true);

--
-- PostgreSQL database dump complete
--

