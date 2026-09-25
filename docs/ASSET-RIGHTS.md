# Third-party image rights

更新日期：2026-09-25
状态：现行部署约束
适用范围：Image ingestion, storage, display and AI processing

The repository's MIT license covers its code, not Unsplash photographs or other
third-party media. No photograph dataset or additional media license is granted
by cloning or redistributing this repository.

Before enabling ingestion, the operator must establish permission for the intended
API use, storage, redistribution and AI processing. The current pipeline stores
images in R2 and processes them with AI; compatibility with the operator's image
license and API agreement must be verified separately. Unsplash API integrations
have requirements including hotlinking, attribution and download reporting:
https://unsplash.com/api-terms and https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines.
An additional agreement must not be assumed from possession of an API key.

Historical credentials must be revoked at their provider before a release is
considered cleared. Removing a value from current files does not revoke it.
This change does not rotate credentials, alter deployed media or rewrite history.
