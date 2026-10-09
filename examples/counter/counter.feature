@counter
Feature: Counter
  A user creates counters and changes them within fixed bounds.
  Counters count between 0 and 5 and can be disabled, which freezes them.

  Scenario: Creating a counter
    Given no counter exists
    When the counter is created
    Then the counter value is 0
    And the counter is active

  Scenario: A counter is created only once
    Given a counter was created
    When the counter is created again
    Then the change is rejected because the counter already exists

  Scenario: Counting up
    Given a counter was created
    When the counter is incremented 2 times
    Then the counter value is 2

  Scenario: Counting down
    Given a counter at value 2
    When the counter is decremented
    Then the counter value is 1

  Scenario: The counter never counts above 5
    Given a counter at value 5
    When the counter is incremented
    Then the change is rejected because the counter reached its maximum

  Scenario: The counter never counts below 0
    Given a counter was created
    When the counter is decremented
    Then the change is rejected because the counter reached its minimum

  Scenario: Disabling a counter freezes it
    Given a counter at value 2
    When the counter is disabled
    And the counter is incremented
    Then the change is rejected because the counter is disabled

  Scenario: A missing counter cannot change
    Given no counter exists
    When the counter is incremented
    Then the change is rejected because the counter does not exist
