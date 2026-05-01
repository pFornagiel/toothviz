## Engineering Thesis 

## _Machine learning based application for CBCT image analysis_
(*Aplikacja wykorzystująca uczenie maszynowe do analizy obrazów CBCT*)


Paweł Fornagiel, Katarzyna Bęben, Łukasz Dragon, Emil Żychowicz

---

Current folder structure:

- `notes` — markdown files with summaries and research (mainly in polish)
    - `thesis_resource` — main knowledge base, will be reused for thesis writing
    - `links` — links to sources reviewed, which seem to be worth reading about
    - `internal_meetings` — notes from meetings
    - `other` — other things, which do not fit elsewhere
- `packages/prototyping` — earlier PoC code (`core`, `db`, `poc_file_storage`, `poc_ml_worker`)
- `packages/models` — ONNX and other model assets (e.g. `railnet_dental.onnx`)
- `packages/application` — main app working Proof-Of-Concept: `backend`, `frontend`, `data`, `tests`, `test_files`, `logs`
