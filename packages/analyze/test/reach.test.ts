import { expect, test } from "bun:test";
import { reach } from "../src/reach.ts";

const kinds = (text: string) => reach(text).map((t) => `${t.kind}/${t.pattern}`);

test("courts: stripping jurisdiction, review or contempt power is tagged, with the sentence quoted", () => {
  const mvp =
    "(d) Expedited Approval .- The Secretary shall issue all permits. (e) Judicial Review .- (1) Notwithstanding any other provision of law, no court shall have jurisdiction to review any action taken by the Secretary of the Army that grants an authorization for the Mountain Valley Pipeline. (2) The United States Court of Appeals for the District of Columbia Circuit shall have original and exclusive jurisdiction over any claim alleging the invalidity of this section.";
  expect(reach(mvp)).toEqual([
    {
      kind: "courts",
      pattern: "no-court",
      quote:
        "(1) Notwithstanding any other provision of law, no court shall have jurisdiction to review any action taken by the Secretary of the Army that grants an authorization for the Mountain Valley Pipeline.",
    },
  ]);
  expect(
    kinds(
      "No court of the United States may enforce a contempt citation for failure to comply with an injunction or temporary restraining order if no security was given.",
    ),
  ).toEqual(["courts/no-court"]);
  expect(
    kinds(
      "Each such authorization shall be deemed to satisfy all requirements of all applicable Federal law and shall not be subject to judicial review.",
    ),
  ).toEqual(["courts/no-judicial-review", "review/deemed-to-satisfy-law"]);
});

test("a routine bar on reviewing payment determinations is not tagged", () => {
  expect(
    kinds(
      "(8) Review .- There shall be no administrative or judicial review under section 1869 or otherwise of the determination of payment amounts under this subsection.",
    ),
  ).toEqual([]);
});

test("states: barring states from their own laws is tagged; savings clauses are not", () => {
  expect(
    kinds(
      "(c) Moratorium (1) In general Except as provided in paragraph (2), no State or political subdivision thereof may enforce, during the 10-year period beginning on the date of the enactment of this Act, any law or regulation of that State limiting artificial intelligence models.",
    ),
  ).toEqual(["states/no-state-may"]);
  expect(
    kinds(
      "The provisions of this section supersede and preempt any State requirement for a charter, license, or other authorization to do business.",
    ),
  ).toEqual(["states/supersedes-state-law"]);
  expect(
    kinds("Nothing in this section shall be construed to preempt any State law relating to smoke alarms."),
  ).toEqual([]);
  expect(
    kinds(
      "Nothing in this section shall be construed to- (1) relieve any recipient of an obligation; or (2) preempt any State law, regulation, rule, or order.",
    ),
  ).toEqual([]);
  expect(
    kinds(
      "Credit assistance shall not- (1) relieve any recipient of any obligation; or (3) otherwise supersede any State or local law applicable to the project.",
    ),
  ).toEqual([]);
  expect(
    kinds("A State may not establish a regressive target for the measures described under paragraph (4)."),
  ).toEqual([]);
});

test("lawsuit: a right to sue the United States, set damages and waived immunity are tagged", () => {
  const senate =
    "(2) Cause of action .- Any Senator whose Senate data has been disclosed in violation of this section may bring a civil action against the United States if the violation was committed by an officer of the United States. (3) Relief .- the greater of statutory damages of $500,000 or the amount of actual damages. (5) Waiver of sovereign immunity .- The United States expressly waives sovereign immunity with respect to actions brought under this subsection.";
  expect(kinds(senate)).toEqual(["lawsuit/sue-the-united-states"]);
  expect(
    kinds(
      "The United States expressly waives sovereign immunity with respect to actions brought under this subsection.",
    ),
  ).toEqual(["lawsuit/waives-sovereign-immunity"]);
  expect(
    kinds("Nothing in subitem (AA) is intended to be or shall be construed as a waiver of Tribal sovereign immunity."),
  ).toEqual([]);
});

test("review: switching off NEPA or notice and comment is tagged; the Paperwork Reduction Act and FOIA are not", () => {
  expect(
    kinds(
      "Any action taken to implement the provisions of this section shall not be subject to the provisions of section 553 of title 5, United States Code .",
    ),
  ).toEqual(["review/skips-review-law"]);
  expect(
    kinds(
      "Any reporting requirements relating to customer satisfaction assessments shall not be subject to chapter 35 of title 44 (commonly known as the Paperwork Reduction Act ).",
    ),
  ).toEqual([]);
  expect(
    kinds("Such information shall be exempt from disclosure under section 552(b)(3) of title 5, United States Code ."),
  ).toEqual([]);
});

test("rule: voiding, delaying or defunding a named rule is tagged; a sunset or a 'shall not apply' is not", () => {
  expect(
    kinds(
      "The Secretary of Health and Human Services shall not, prior to January 1, 2032, implement, administer, or enforce the provisions of the final rule published by the Office of the Inspector General on November 30, 2020.",
    ),
  ).toEqual(["rule/may-not-carry-out-rule"]);
  expect(
    kinds(
      'None of the funds made available by this Act may be used to implement, administer, or enforce the "variety" requirements of the final rule entitled "Enhancing Retailer Standards".',
    ),
  ).toEqual(["rule/no-funds-for-rule"]);
  expect(
    kinds(
      "That Congress disapproves the rule submitted by the Federal Communications Commission (89 Fed. Reg. 67303 (August 20, 2024)), and such rule shall have no force or effect.",
    ),
  ).toEqual(["rule/rule-no-force"]);
  expect(
    kinds("(d) Sunset .- This section shall have no force or effect on the date that is 5 years after enactment."),
  ).toEqual([]);
  expect(
    kinds(
      "This section shall not apply with respect to any amount of an eligible credit which is allowed pursuant to rules similar to the rules of subsection (c)(4).",
    ),
  ).toEqual([]);
  expect(
    kinds(
      "None of the funds may be used to pay the salaries of personnel to implement any activities related to the permitting of non-recording of observed violations of the Animal Welfare Act or its regulations.",
    ),
  ).toEqual([]);
});

test("a standing bar on rules Congress already disapproved is not tagged", () => {
  expect(
    kinds(
      "None of the funds made available pursuant to the provisions of this or any other Act shall be used to implement, administer, or enforce any regulation which has been disapproved pursuant to a joint resolution duly adopted in accordance with the applicable law of the United States.",
    ),
  ).toEqual([]);
});

test("a bare 'notwithstanding any other provision of law' is not reach, and struck wording takes reach away", () => {
  expect(kinds("Notwithstanding any other provision of law, the Secretary shall make grants to States.")).toEqual([]);
  expect(
    kinds(
      'Section 5 is amended by striking "no court shall have jurisdiction to review" and inserting "a court may review".',
    ),
  ).toEqual([]);
});

test("reach-v2: a bar on review worded as 'No … shall be subject to judicial review', and a State's standing to sue a Secretary", () => {
  // Fiscal Responsibility Act §267.
  expect(
    kinds(
      "267. Judicial review No determination, finding, action, or omission under this title shall be subject to judicial review.",
    ),
  ).toEqual(["courts/no-judicial-review"]);
  expect(kinds("Not later than 30 days after it is made, the decision shall be subject to judicial review.")).toEqual(
    [],
  );
  expect(kinds("No later than 30 days after it is made, the decision shall be subject to judicial review.")).toEqual(
    [],
  );
  // Laken Riley Act §3.
  expect(
    kinds(
      "The attorney general of a State alleging a violation that harms such State or its residents shall have standing to bring an action against the Secretary of Homeland Security on behalf of such State.",
    ),
  ).toEqual(["lawsuit/standing-to-sue"]);
});
