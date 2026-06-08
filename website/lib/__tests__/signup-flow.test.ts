import { strict as assert } from "node:assert";
import {
  checkoutPlanFromParam,
  destinationAfterSignup,
  googleNextPathForPlan,
} from "../signup-flow";

assert.equal(checkoutPlanFromParam(null), "free");
assert.equal(checkoutPlanFromParam("starter"), "starter");
assert.equal(checkoutPlanFromParam("pro"), "pro");
assert.equal(checkoutPlanFromParam("pro_plus"), "pro_plus");
assert.equal(checkoutPlanFromParam("teams"), "free");
assert.equal(checkoutPlanFromParam("unknown"), "free");

assert.equal(destinationAfterSignup("free"), "/dashboard?welcome=1");
assert.equal(destinationAfterSignup("starter"), "/billing?plan=starter");
assert.equal(destinationAfterSignup("pro"), "/billing?plan=pro");
assert.equal(destinationAfterSignup("pro_plus"), "/billing?plan=pro_plus");

assert.equal(googleNextPathForPlan("free"), "/dashboard?welcome=1");
assert.equal(googleNextPathForPlan("pro"), "/billing?plan=pro");
