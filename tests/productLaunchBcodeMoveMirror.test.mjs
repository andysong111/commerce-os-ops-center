import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("B코드 이동은 기존 12자리 옵션번호를 보존하고 normalized·legacy 상태를 함께 갱신한다", async () => {
  const migration = await source(
    "supabase/migrations/20261029073042_preserve_option_barcode_on_bcode_move_and_mirror_location.sql",
  );

  assert.match(migration, /v_previous_kind = 'B_CODE' and v_kind in \('B_CODE','OPTION'\)/);
  assert.match(migration, /'previousIdentityKey', v_previous_identity/);
  assert.match(migration, /'existingOptionBarcodeNo', v_existing_no/);
  assert.match(migration, /when tg_op = 'UPDATE' then coalesce\(new\.barcode, ''\)/);
  assert.match(migration, /new\.option_barcode_no := v_no/);
  assert.match(migration, /new\.option_payload := new\.option_payload \|\| jsonb_build_object/);
  assert.match(migration, /update public\.product_launch_tracker_states/);
  assert.match(migration, /'optionLocations', v_option_locations/);
  assert.match(migration, /'readiness', v_readiness/);
});

test("과거 OPTION identity가 남아 있어도 위치 보류 identity로 현재 옵션번호를 보존한다", async () => {
  const migration = await source(
    "supabase/migrations/20261029073212_allow_explicit_option_hold_identity.sql",
  );
  const reconciliation = await source(
    "supabase/migrations/20261029073223_reconcile_owner_confirmed_bcodes_aaa410_aaa413.sql",
  );

  assert.match(migration, /elsif v_explicit_identity like 'OPTION:%'/);
  assert.match(reconciliation, /OPTION:HOLD:LOCATION:20261029:/);
});

test("실물 확인 위치는 옵션명으로 연결하며 AAA414 단종 상태를 되살리지 않는다", async () => {
  const migration = await source(
    "supabase/migrations/20261029073223_reconcile_owner_confirmed_bcodes_aaa410_aaa413.sql",
  );

  const expected = [
    ["AAA410", "브라운", "BDG5-1"],
    ["AAA410", "화이트", "BDG5-2"],
    ["AAA410", "핑크", "BDG5-3"],
    ["AAA410", "그레이", "BDG6-1"],
    ["AAA412", "화이트", "BDF4-1"],
    ["AAA412", "베이지", "BDF4-2"],
    ["AAA413", "브라운", "BDE5-1"],
    ["AAA413", "베이지", "BDE5-2"],
    ["AAA413", "화이트", "BDE5-3"],
  ];
  for (const [model, option, barcode] of expected) {
    assert.match(migration, new RegExp(`'${model}', '${option}', '${barcode}'`));
  }
  assert.match(migration, /AAA414_DISCONTINUED_GUARD_FAILED/);
  assert.match(migration, /owner_direct_physical_confirmation_20261029/);
  assert.match(migration, /'위치 확인 필요'/);
  assert.doesNotMatch(migration, /update public\.product_launch_items[\s\S]*model_number = 'AAA414'/);
});
