import { Given, type DataTable } from "@cucumber/cucumber";
import { BenchmarkWorld } from "./world.ts";

const append = (world: BenchmarkWorld, event: string): void => {
  world.events.push(event);
};

Given("the minimalism inside a background", function (this: BenchmarkWorld) {
  append(this, "background");
});

Given(/^the (minimalism|more minimalism)$/, function (this: BenchmarkWorld, text: string) {
  append(this, text);
});

Given("the @delimits tags", function (this: BenchmarkWorld) {
  append(this, "joined tags");
});

Given("a comment", function (this: BenchmarkWorld) {
  append(this, "comment");
});

Given("a comment is preceded by a space", function (this: BenchmarkWorld) {
  append(this, "comment is preceded by a space");
});

Given(
  /^a (simple data table|data table with .+)$/,
  function (this: BenchmarkWorld, text: string, _table: DataTable) {
    append(this, text);
  },
);

Given(
  /^a (simple DocString|DocString with .+)$/,
  function (this: BenchmarkWorld, text: string, _docString: string) {
    append(this, text);
  },
);

Given("fb", function (this: BenchmarkWorld) {
  append(this, "feature background");
});

Given("ab", function (this: BenchmarkWorld) {
  append(this, "rule background");
});

Given("a", function (this: BenchmarkWorld) {
  append(this, "example a");
});

Given("b", function (this: BenchmarkWorld) {
  append(this, "example b");
});
