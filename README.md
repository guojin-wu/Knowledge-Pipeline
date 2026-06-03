# Knowledge Base

Standalone package for the data-ingestion and email-cleaning workspace.

## Structure

- `frontend/`: pipeline UI, QA review tools, and cleaning scripts
- `backend/`: local auth routes plus a lightweight `/kb/refine` scaffold

## Notes

- The original repo referenced a refine backend but did not include its implementation here.
- This folder now has an isolated backend entrypoint so it can be deployed independently on Vercel later.
