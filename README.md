# Sweeplune

Cleaning-service catalogue, customer booking history, and administrator service and booking management. React/Vite/Tailwind frontend, Express API, MongoDB persistence, cookie sessions, and Argon2id passwords. Appointments use Europe/Budapest time.

## Local setup

Use Node 24 and a running local MongoDB service. From this project root:

```powershell
npm run setup
```

Copy `server/.env.example` to `server/.env` and set a real local `SESSION_SECRET`. Keep the existing `.env` when applying this update to a working project. No credentials are included in this archive.

Generate a secret locally:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Seed the initial catalogue once:

```powershell
npm --prefix server run seed
```

In two separate terminals:

```powershell
npm --prefix server run dev
```

```powershell
npm --prefix client run dev
```

Open http://localhost:5173. Development uses Vite's existing API proxy. Do not enable production mode when using the development HTTP frontend.

## Verification

From the root, `npm test` runs four focused deployment checks without MongoDB. `npm run build` builds the real frontend. For full integration tests, keep the development backend running and execute the security suite from the `server` directory:

```powershell
cd server
npm run test:security
```

Enter an existing admin's credentials in the terminal. Do not put them in source files or reports. The script creates labelled fixtures; read its summary and cleanup notes.

The separate local workload is `npm run test:performance` from `server`. It creates its own local database and API process. Reports are under `server/test-results`. See [deployment instructions](docs/DEPLOYMENT.md) and [review findings](docs/DEPLOYMENT-REVIEW.md).

## Production commands

Run `npm run setup`, then `npm run build` from the root. Configure the hosting environment and use `npm start` from the root. The Express process serves both `/api` and `client/dist`, keeping the browser and API on one origin.

An optional multi-stage Dockerfile is included. It has not been built in this review environment because Docker is unavailable. Do not treat the Docker image or cloud deployment as verified until built and tested on the selected host.
