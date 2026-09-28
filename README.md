# noFraud

NoFraud Integration

### Development Environment

The development environment is setup to run two docker containers, an API container and MySQL8 container.

#### Preresquisites

- Mac OS Running recent version (Not tested on Windows)
- Docker Desktop

#### Initial setup

- Copy the .env-sample to .env.development and populate the variables
- Adjust the COMPOSE_PROJECT_NAME,APP_PORT, Database hosts and ports to avoid conflicts with other APPs if you run multiple APPs locally.
- The container names will be prefixed with COMPOSE_PROJECT_NAME, as well as the docker volume and image.
- Run npm install from a terminal window on your Mac.

#### Starting containers

This command stops all containers for this APP and starts them again.

```
npm start
```

#### Container Storage Volumes

MySQL8 Container

- Uses a docker volume for persistent a persistent docker database volume that remains after stopping or restarting containers.

API Container

- Uses a bind mount back to your local MacOS APP folder, so any changes you make to the APP on your MAC are automatically available in the container and Nodmon will restart the APP running in the container automatically.

### Production Environment - Backend

#### Preresquisites

- Mac OS Running recent version (Not tested on Windows)
- Docker Desktop
- AWS CLI V2 Installed.
- Run aws configure sso and choose Commerce7 as session name, select Commerce7Apps account, choose the role, use default region and profile name to nofraud.
- Domain registered in AWS Route53 or at a minimum the DNS hosted by Route53 for the domain.

#### Shared infrastructure

NoFraud runs on the shared VPC, NAT gateways and Aurora MySQL cluster (`mysql8-app-cluster`) in the Commerce7 Apps account. That infrastructure is deployed as the `app-shared-infrastructure` CloudFormation stack and is managed from the [Vinoshipper repo](https://github.com/Commerce7/vinoshipper), not from here. NoFraud's `api/template.yml` only imports its outputs (subnets, DB host, security groups, certificate).

Do not deploy shared infrastructure from this repo.

#### Initial setup

- Get the production deploy files from 1Password (Fullsteam account, **Commerce7 - Development** vault). They are not committed to this repo:
  - `nofraud - env.production 260924` → save as `api/.env.production`. The deploy only reads `APP_NAME`, `API_DOMAIN_NAME`, `HOSTED_ZONE_ID` and `FORCE_DEPLOY` from it; the `DB_*` values are used for production migrations.
  - `nofraud - samconfig.toml 260924` → save as `api/samconfig.toml`. SAM reads it from the directory `npm run deploy` runs in (`api/`), and needs it to resolve the deployment S3 bucket.
  - `nofraud - deploy.sh 260924` → copy of the deploy script used for the 2026-09-24 production deploy, for reference.

#### App secrets

The app's secrets (C7 app credentials, SendGrid key, NoFraud URLs, app API credentials, Rollbar token) live in the [`/nofraud/env` secret](https://us-west-2.console.aws.amazon.com/secretsmanager/secret?name=%2Fnofraud%2Fenv&region=us-west-2) in AWS Secrets Manager (Commerce7 Apps account). It is managed by hand in the console, not by this repo's CloudFormation.

To change a value, edit the secret and redeploy. The Lambda only picks up new values when it's redeployed:

1. Edit `/nofraud/env` in the AWS console (Retrieve secret value → Edit).
2. Change `FORCE_DEPLOY` in `api/.env.production` (e.g. to today's date). Otherwise the deploy sees no changes and skips the Lambda.
3. Run `npm run deploy`.

> **Temporary setup.** Deploys still run from a laptop with a local `samconfig.toml`. They will move to AWS CodeBuild ([SC-25849](https://app.shortcut.com/commerce7/story/25849)).

### Running production database migrations

The bastion host was removed from the shared infrastructure. Connect to the production database over the VPN instead.

- Make sure you are connected to the VPN
- In `.env.production`, point the database at the Aurora writer endpoint directly (RDS → Databases → `mysql8-app-cluster`):

```
DB_WRITER_HOST=mysql8-app-cluster.cluster-cqfav9pnem8u.us-west-2.rds.amazonaws.com
DB_READER_HOST=mysql8-app-cluster.cluster-cqfav9pnem8u.us-west-2.rds.amazonaws.com
DB_PORT=3306
```

- Run create database and migrations

```
npm run sequelize:prod:create
npm run sequelize:prod:migrate
```

### Deploying the APP

- Note you can switch to a branch and deploy and that will go live. so Make sure you are on the correct branch when deploying.

```
npm run deploy
```

### Production Environment - Frontend

#### Initial setup

- Copy the build/production/secrets/production-parameters-sample.json to build/production/secrets/production-parameters.json and populate variables.

  - CertificateDomainName: The domain name you registered or added DNS hosting for in Route53
  - HostedZoneId: The hostedZoneId - get this from Route53 for the domain you registered.

- Create S3 Bucket, Cloudfront Distribution and Wildcard SSL certificate in us-east-1 (single npm script to run all three. This stack is created in us-east-1 region for Cloudfront)

```
cd frontend
npm run deploy:app:infrastructure
```

- Deploy frontend

```
npm run deploy
```

### Production URLs

- The APPNAME is created using the root folder name, so if your root folder is noFraud, then the APPNAME = noFraud

- API URL = {APPNAME}-app.{certificateDomainName}

  - eg. https://noFraud-app.tinygrape.co

- Frontend URL = {APPNAME}-frontend.{certificateDomainName}
  - eg. https://noFraud-frontend.tinygrape.co

### Tail production logs

```
npm run tail:logs
```
