@greeter
Feature: Greeter API
  The app serves a typed health endpoint that greets in a configured language.
  Each scenario boots the real server on an ephemeral port and calls the
  typed client.

  Scenario Outline: The health check greets in the chosen language
    Given the app is running with the <language> greeter
    When the health check is requested
    Then the response says status ok and greeting <expected>

    Examples:
      | language | expected |
      | en       | Hello!   |
      | es       | ¡Hola!   |
