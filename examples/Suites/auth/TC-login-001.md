---
specorator: testcase
id: TC-login-001
title: Login with valid credentials
suite: auth
tags: [smoke, auth]
status: ready
---
# Login with valid credentials

The user signs in from the login page and lands on the dashboard. The Gherkin
below is the executable scenario; this prose is living documentation.

Run it headless with:

```
specorator run --case examples/Suites/auth/TC-login-001.md --base-url https://example.com
```

```gherkin
@smoke @auth
Feature: Login

  Background:
    Given the user opens "/login"

  Scenario: Valid credentials
    When the user fills "label=Email" with "user@example.com"
    And the user fills "label=Password" with "correct horse battery staple"
    And the user clicks "role=button[Sign in]"
    Then the page should show "Welcome"
    And the url should contain "/dashboard"
```
