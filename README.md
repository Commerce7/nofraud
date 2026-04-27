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

#### Initial setup

- Copy the build/production/secrets/production-parameters-sample.json to build/production/secrets/production-parameters.json and populate variables.

  - VpcSubnet: Should be a valid AWS Internal VPC subnet if you have multiple VPCs ensure this one does not overlap.
  - DbAdminUsername: This will be the username for the production aurora instance
  - DbAdminPassword: This will be the password for the production aurora instance
  - CertificateDomainName: The domain name you registered or added DNS hosting for in Route53
  - HostedZoneId: The hostedZoneId - get this from Route53 for the domain you registered.

- Copy the .env-sample to .env.production and populate the variables

### Deploying infrastructure

- Deploy Shared VPC, Aurora Database and ECS Cluster

```
cd api
npm run deploy:shared:infrastructure
```

- Get the Bastion Host keypair.pem file saved to secrets already in .gitignore

```
npm run get:keypair
```

- Login to AWS

  - navigate to RDS --> Databases --> myslq8-app-cluster and copy the writer endpoint name
  - navigate to EC2 --> Instances --> app-shared-infrastructure-bastion and copy the public IPv4 DNS

- Update the script in package.json replacing the cluster name and ec2-user IP address.

```
"start:bastion": "ssh -i build/production/bastion-keypair.pem -f -N -L 4416:mysql8-app-cluster.cluster-cbg8bxyosl30.us-west-2.rds.amazonaws.com:3306 ec2-user@35.165.67.213 -vvv",
```

- Run create database and migrations

```
[Open a new terminal window and keep it open until migrations are complete.]
npm run start:bastion

[open new terminal window and run migrations]
npm run sequelize:prod:create
npm run sequelize:prod:migrate
```

- Deploy ECR Repo, Push Docker Image, Deploy ALB and ECS Containers (single npm script to run all three)

```
npm run deploy:app:infrastructure
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
