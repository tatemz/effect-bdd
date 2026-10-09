Feature: Counter
  A user creates counters and changes them.

  Scenario: Creating a counter
    Given no counter exists
    When the counter is created
    Then the counter value is 0

  Scenario: Counting up
    Given a counter was created
    When the counter is incremented 2 times
    Then the counter value is 2

  Scenario: Counting down
    Given a counter at value 2
    When the counter is decremented
    Then the counter value is 1
