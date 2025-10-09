# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial project setup with Cloudflare Workers architecture
- Automated photo collection from Unsplash API
- AI-powered image classification using 2 models
- Cursor-based sync to prevent duplicates
- Checkpoint system for fault-tolerant processing
- Real-time stats dashboard
- Separate download and classify workflows

### Changed
- Increased fetch rate to 60 photos per run (2 API requests)
- Cron schedule set to every 10 minutes
- Reduced AI models from 4 to 2 for better performance

### Fixed
- D1 schema issues with nullable fields
- Workflow retry logic
- Processing queue bottlenecks

## [0.1.0] - 2025-10-10

### Added
- Initial release
- Basic photo collection and storage
- AI classification
- Web frontend
