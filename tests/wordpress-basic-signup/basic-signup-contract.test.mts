import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const php = read("ops/wordpress-basic-signup/inrcy-basic-signup.php");

test("the isolated Basic access renderer matches the verified 1.6.1 renderer and retains the fixed ticket-only POST", () => {
  const original = read("ops/wordpress-visio-booking/inrcy-visio-booking.js").replace("function inrcyVisioBooking($)", "function inrcyBasicSignupAccess($)").replaceAll("window.inrcyVisioBookingConfig", "window.inrcyBasicSignupAccessConfig");
  assert.equal(read("ops/wordpress-basic-signup/basic-access.js"), original);
  assert.equal(read("ops/wordpress-basic-signup/basic-access.css"), read("ops/wordpress-visio-booking/inrcy-visio-booking.css"));
  assert.match(php, /'inrcyBasicSignupAccessConfig', array\('showBooking' => false/);
  assert.match(php, /if \(!inrcy_basic_signup_is_page\(\)\) \{ return; \}[\s\S]*?wp_dequeue_script\('inrcy-visio-booking'\)/);
});

test("the direct signup mode and secret header are decided on the server while public configuration contains no secret", () => {
  assert.match(php, /defined\('INRCY_TRIAL_SIGNUP_TOKEN'\)/);
  assert.match(php, /return \$configured !== '' \? \$configured : trim\(\(string\) get_option/);
  assert.match(php, /update_option\(INRCY_BASIC_SIGNUP_SECRET_OPTION, \$secret, false\)/);
  assert.match(php, /'signup_mode' => 'direct_basic', 'source' => 'wordpress-basique'/);
  assert.match(php, /wp_remote_post\('https:\/\/app\.inrcy\.com\/api\/public\/basic-signup'/);
  assert.match(php, /'x-trial-signup-secret' => \$secret/);
  assert.match(php, /'redirection' => 0/);
  assert.doesNotMatch(php, /basic-signup\?token=/);
  const publicConfig = php.match(/wp_localize_script\('inrcy-basic-signup',[^;]+;/)?.[0];
  assert.ok(publicConfig);
  assert.doesNotMatch(publicConfig, /secret|TOKEN/);
  assert.match(php, /'login_url'\] !== 'https:\/\/app\.inrcy\.com\/api\/auth\/signup-access'/);
  assert.match(php, /strcasecmp\(\$access\['email'\], \$body\['email'\]\)/);
  assert.match(php, /\$json\['direct_signup'\] \?\? null\) !== true/);
  assert.match(php, /\$json\['activation_required'\] \?\? null\) !== true/);
  assert.match(php, /\$json\['trial_days'\] \?\? null\) !== 0/);
  assert.match(php, /!array_key_exists\('trial_end_at', \$json\) \|\| \$json\['trial_end_at'\] !== null/);
});

test("the admin action creates a draft only if /basique is absent and the visible offer explains cancellation", () => {
  const action = php.slice(php.indexOf("add_action('admin_post_inrcy_basic_signup_create_page'"), php.indexOf("add_filter('template_include'"));
  assert.match(action, /current_user_can\('manage_options'\)/);
  assert.match(action, /check_admin_referer\('inrcy_basic_signup_create_page'\)/);
  assert.match(action, /get_page_by_path\('basique', OBJECT, 'page'\)/);
  assert.ok(action.indexOf("if ($existing)") < action.indexOf("wp_insert_post"));
  assert.match(action, /'post_status' => 'draft'/);
  assert.doesNotMatch(action, /wp_update_post|publish/);
  assert.match(php, /Résiliation avec préavis : un renouvellement mensuel supplémentaire\./);
  assert.doesNotMatch(php, /21 jours|essai gratuit/);
});
