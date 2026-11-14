# Upload the source to GitHub

The project is prepared for a repository. No repository has been created or uploaded during this redesign.

After downloading a ZIP from GitHub, use **Extract All** before running `Start-FastUp.cmd`. Run the launcher inside the extracted folder beside `package.json` and `scripts`. The demo does not depend on an environment template; `.env.example` should still be included in the repository as an optional deployment reference.

1. Extract `Fast-Up-App.zip` and open a terminal inside the extracted `fast-up` folder.
2. Create an empty repository in your GitHub account. Leave the initial README, license and gitignore unchecked because this folder already contains project files.
3. Run these commands, replacing `YOUR-ACCOUNT` and the repository name:

```sh
git init -b main
git add .
git status --short
git commit -m "Add Fast Up maintenance app"
git remote add origin https://github.com/YOUR-ACCOUNT/fast-up.git
git push -u origin main
```

Before committing, the status should contain source, examples, migrations, tests and documentation. `.gitignore` excludes local databases, dependencies, backups, environment files and private keys. The release ZIP excludes these as well. Demo accounts and their documented password are synthetic evaluation fixtures; production explicitly disables demo mode.

The included workflow runs syntax checks, the full local suite and an external PostgreSQL 17 integration test on Node 24. The database and password in the workflow are disposable test fixtures. The workflow has not run on GitHub yet. Its action versions follow the official [checkout](https://github.com/actions/checkout) and [setup-node](https://github.com/actions/setup-node) usage examples checked for this release.

Uploading the source does not host the app. This project has a Node server and PostgreSQL backend; GitHub Pages alone cannot run it. Local evaluation and production deployment instructions are in `README.md`.

To run the external PostgreSQL test locally, set `FASTUP_TEST_DATABASE_URL` to a test server account allowed to create databases. The test creates a uniquely named database, runs against that database, and drops only the database it created. The ordinary suite uses isolated in-memory PGlite databases and fake IndexedDB.
