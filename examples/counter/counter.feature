Feature: Counter
  A user creates counters and changes them.

  Scenario: Creating a counter
    Given no counter exists
    When the counter is created
    Then the counter value is 0

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

  Scenario: A missing counter cannot change
    Given no counter exists
    When the counter is incremented
    Then the change is rejected because the counter does not exist
