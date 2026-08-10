#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import { BirBackendStack } from '../lib/bir-backend-stack';

const app = new cdk.App();

new BirBackendStack(app, 'BirFestival2026Backend', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-south-1',
  },
  description: 'Bir Festival 2026 backend — Cognito, AppSync, DynamoDB, Lambda, S3/CloudFront',
});
