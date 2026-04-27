#!/bin/zsh

# Set Credentials

if aws --profile nofraud sts get-caller-identity > /dev/null; then
 echo "SESSION TOKEN VALID"
sessioncredentials=$(aws configure export-credentials --profile nofraud)
export AWS_ACCESS_KEY_ID=$(jq -r '.AccessKeyId' <<< ${sessioncredentials})
export AWS_SECRET_ACCESS_KEY=$(jq -r '.SecretAccessKey' <<< ${sessioncredentials})
export AWS_SESSION_TOKEN=$(jq -r '.SessionToken' <<< ${sessioncredentials})
 else
 echo "SESSION TOKEN EXPIRED - LOGIN TO REFRESH TOKEN"
unset AWS_SESSION_TOKEN

aws sso login --profile nofraud

sessioncredentials=$(aws configure export-credentials --profile nofraud)
export AWS_ACCESS_KEY_ID=$(jq -r '.AccessKeyId' <<< ${sessioncredentials})
export AWS_SECRET_ACCESS_KEY=$(jq -r '.SecretAccessKey' <<< ${sessioncredentials})
export AWS_SESSION_TOKEN=$(jq -r '.SessionToken' <<< ${sessioncredentials})
fi
# export envars with underscore
export $(egrep -v '^#' .env | xargs)


echo $APP_NAME
npm install
rm -rf dependencies/nodejs/node_modules
cp -r node_modules dependencies/nodejs/
cp package.json ./api

# Deploy Infrastructure for APP
sam deploy \
    --region us-west-2 \
    --stack-name $APP_NAME \
    --template-file template.yml \
    --parameter-overrides ApiDomainName=$API_DOMAIN_NAME HostedZoneId=$HOSTED_ZONE_ID C7ApiUrl=$C7_API_URL C7AppId=$C7_APP_ID C7AppSecret=$C7_APP_SECRET SendGridApiKey=$SENDGRID_API_KEY NoFraudApiUrl=$NOFRAUD_API_URL NoFraudPortalApiUrl=$NOFRAUD_PORTAL_API_URL AppApiUsername=$APP_API_USERNAME AppApiPassword=$APP_API_PASSWORD ForceDeploy=$FORCE_DEPLOY