# AGENTS.md - Updates and Operations Log

## Updates Performed:

- **Inspection:** Reviewed CDK stack code for SNS->SQS subscriptions and analyzed policies for PendingConfirmation cases.
- **Search Operations:** Verified for misconfigured protocols or cross-account settings involving wrong Source/Principals.
- **Condition & Mismatch Evaluations:** Examined TopicPolicy and SQS-queue properties for elements like SourceArn, AWS regions.
- Implemented fixes to support these operational misconfigs in ./Budget-Stack modules.
- **Custom resource fixes (SNS↔SQS subscription):** Updated the `subscribe-sqs` provider Lambda to unsubscribe on CloudFormation `Delete` using `event.Data.SubscriptionArn`, and adjusted Jest tests to avoid brittle `SNSClient.mock.instances` usage by injecting a shared `sendMock`.
- **SQS queue policy fix:** Updated the aggregation queue resource policy `aws:SourceArn` construction to match real SNS topic ARNs (avoids `ArnFormat.NO_RESOURCE_NAME` generating `arn:...:sns:region:*:budget-alerts`, which can leave subscriptions in PendingConfirmation).
- **Tests:** Ran `npm test --silent` successfully (10/10 suites, 68/68 tests, 4/4 snapshots).
- **Lint:** `npm run lint` currently times out in this environment (needs follow-up).
