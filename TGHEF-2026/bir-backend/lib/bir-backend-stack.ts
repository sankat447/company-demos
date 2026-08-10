import * as path from 'node:path';

import * as cdk from 'aws-cdk-lib';
import {
  aws_appsync as appsync,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_cognito as cognito,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_s3 as s3,
  aws_ssm as ssm,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

/**
 * Bir Festival 2026 backend. Every CfnOutput here maps ONE-TO-ONE onto a key
 * in the mobile app's stack contract (schemas/stack-contract.schema.json).
 * `npm run emit-contract` turns the deploy outputs into config/stack-outputs.json.
 *
 * This scaffold provisions the resources and wiring; the Lambda handlers carry
 * the business logic (custom-auth OTP, ES256 pass signing, payment webhook).
 * Resolver mapping templates are stubbed where the data shape is settled and
 * flagged with TODO where the team must finish the query/mutation surface.
 */
export class BirBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---- Identity: Cognito User Pool (phone OTP via custom auth) ----
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'bir-2026',
      signInAliases: { phone: true },
      selfSignUpEnabled: true,
      autoVerify: { phone: true },
      mfa: cognito.Mfa.OFF,
      standardAttributes: { phoneNumber: { required: true, mutable: false } },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // The role groups the app gates on (ARCHITECTURE §4; CO-003/CO-004).
    for (const group of [
      'visitor',
      'partner',
      'volunteer',
      'organiser-lite',
      'admin-hospitality',
      'safety-officer',
    ]) {
      new cognito.CfnUserPoolGroup(this, `Group-${group}`, {
        userPoolId: userPool.userPoolId,
        groupName: group,
      });
    }

    // Custom-auth Lambda triggers (Define/Create/Verify) send + check the OTP.
    const customAuth = new nodejs.NodejsFunction(this, 'CustomAuthFn', {
      entry: path.join(__dirname, '..', 'lambda', 'custom-auth', 'index.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: { OTP_TTL_SECONDS: '300' },
      description: 'Cognito custom-auth OTP (SNS SMS)',
    });
    userPool.addTrigger(cognito.UserPoolOperation.DEFINE_AUTH_CHALLENGE, customAuth);
    userPool.addTrigger(cognito.UserPoolOperation.CREATE_AUTH_CHALLENGE, customAuth);
    userPool.addTrigger(cognito.UserPoolOperation.VERIFY_AUTH_CHALLENGE_RESPONSE, customAuth);

    const userPoolClient = userPool.addClient('AppClient', {
      authFlows: { custom: true },
      generateSecret: false,
    });

    const identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: userPoolClient.userPoolClientId,
          providerName: userPool.userPoolProviderName,
        },
      ],
    });

    // ---- Data: DynamoDB single-table (system of record) ----
    const table = new dynamodb.Table(this, 'Table', {
      tableName: 'bir-2026',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // festival-week spike
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    // ---- Storage: media + app-distribution buckets behind CloudFront ----
    const mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });
    const appDistBucket = new s3.Bucket(this, 'AppDistBucket', {
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });
    const cdn = new cloudfront.Distribution(this, 'Cdn', {
      defaultBehavior: { origin: origins.S3BucketOrigin.withOriginAccessControl(mediaBucket) },
    });
    const appDistCdn = new cloudfront.Distribution(this, 'AppDistCdn', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(appDistBucket),
      },
    });

    // ---- Pass signing: ES256 issuer Lambda + JWKS ----
    // The private key lives in SSM SecureString / KMS; the public JWKS is
    // served from the media CDN at passes.jwksPath. The app verifies OFFLINE.
    const passSigner = new nodejs.NodejsFunction(this, 'PassSignerFn', {
      entry: path.join(__dirname, '..', 'lambda', 'pass-signer', 'index.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: { ISSUER_KID: 'bir-2026-01', TABLE: table.tableName },
      description: 'Issues + revokes ES256 pass/badge JWTs',
    });
    table.grantReadWriteData(passSigner);

    // ---- Payments: webhook handler (Razorpay → confirm order) ----
    const paymentWebhook = new nodejs.NodejsFunction(this, 'PaymentWebhookFn', {
      entry: path.join(__dirname, '..', 'lambda', 'payment-webhook', 'index.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: { TABLE: table.tableName },
      description: 'Razorpay webhook → mark order CONFIRMED → issue pass tokens',
    });
    table.grantReadWriteData(paymentWebhook);
    passSigner.grantInvoke(paymentWebhook);

    // ---- API: AppSync GraphQL ----
    const api = new appsync.GraphqlApi(this, 'Api', {
      name: 'bir-2026',
      definition: appsync.Definition.fromFile(
        path.join(__dirname, '..', 'schema', 'schema.graphql'),
      ),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: { userPool },
        },
        additionalAuthorizationModes: [{ authorizationType: appsync.AuthorizationType.IAM }],
      },
      xrayEnabled: true,
    });
    const tableDs = api.addDynamoDbDataSource('TableDs', table);
    // TODO(backend): attach resolvers per operation in schema.graphql.
    // Privileged mutations (setFlyStatus, commitAllocation, registerDevice,
    // recordScan, recordAttendance, reportIncident) run through Lambda data
    // sources that re-check the Cognito group and audit-log — the client role
    // gate is UX only (see docs/BACKEND_ASKS.md). `tableDs` is the read/write
    // path for the non-privileged queries.
    void tableDs;

    // ---- Ops params ----
    new ssm.StringParameter(this, 'FlyStatusTopicParam', {
      parameterName: '/bir/ops/flyStatusTopic',
      stringValue: 'REPLACE_WITH_SNS_TOPIC_ARN',
    });

    // ================= OUTPUTS → stack contract =================
    const out = (key: string, value: string) => new cdk.CfnOutput(this, key, { value, exportName: `bir-${key}` });
    out('region', this.region);
    out('authUserPoolId', userPool.userPoolId);
    out('authUserPoolClientId', userPoolClient.userPoolClientId);
    out('authIdentityPoolId', identityPool.ref);
    out('apiGraphqlEndpoint', api.graphqlUrl);
    out('apiGraphqlRealtime', api.realtimeUrl);
    out('storageMediaBucket', mediaBucket.bucketName);
    out('storageCdnDomain', cdn.distributionDomainName);
    out('storageAppDistBucket', appDistBucket.bucketName);
    out('storageAppDistDomain', appDistCdn.distributionDomainName);
    out('passesIssuerKid', 'bir-2026-01');
    // restBase (payments/AI via API Gateway) is added when the REST API lands.
  }
}
