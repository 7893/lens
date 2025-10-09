# Contributing to Pic

Thank you for your interest in contributing to Pic! This document provides guidelines for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone <your-fork-url>`
3. Create a feature branch: `git checkout -b feature/your-feature-name`
4. Make your changes
5. Test your changes: `npm test`
6. Commit your changes: `git commit -m "Add your feature"`
7. Push to your fork: `git push origin feature/your-feature-name`
8. Open a Pull Request

## Development Setup

```bash
# Install dependencies
npm install

# Set up environment variables
cp workers/pic-scheduler/.env.example workers/pic-scheduler/.env

# Start development server
npm run dev:scheduler
```

## Code Style

- Use ES6+ syntax
- Follow existing code formatting
- Add comments for complex logic
- Keep functions small and focused

## Testing

Before submitting a PR, ensure:

- All tests pass: `npm test`
- System test passes: `./scripts/test.sh`
- No console errors in development

## Pull Request Guidelines

- Keep PRs focused on a single feature or fix
- Update documentation if needed
- Add tests for new features
- Ensure CI passes

## Reporting Issues

When reporting issues, please include:

- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node version, OS, etc.)

## Questions?

Feel free to open an issue for any questions or discussions.
