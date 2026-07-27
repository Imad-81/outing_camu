require('dotenv').config();
const { firefox } = require('playwright');

const CREDENTIALS = {
  email: process.env.CAMU_EMAIL,
  password: process.env.CAMU_PASSWORD,
  institution: 'woxsen',
  institutionName: 'Woxsen University',
};

const DAY_INDEX = {
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
  friday: 4, saturday: 5, sunday: 6,
};

const CALENDAR_SELECTOR = '.MuiDialog-root, .MuiPopover-root, .Cal__Container, .react-datepicker, [class*="calendar"], [class*="Calendar"], [class*="datepicker"], [class*="DatePicker"], [role="grid"]';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function getMonday() {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function parseDayRange(args) {
  const startArg = (args[2] || 'monday').toLowerCase();
  const endArg = (args[3] || 'sunday').toLowerCase();

  const start = DAY_INDEX[startArg];
  const end = DAY_INDEX[endArg];

  if (start === undefined || end === undefined) {
    console.error('Usage: node outing.js [start_day] [end_day]');
    console.error('Valid days: monday, tuesday, wednesday, thursday, friday, saturday, sunday');
    process.exit(1);
  }

  if (start > end) {
    console.error('Start day must come before end day');
    process.exit(1);
  }

  const monday = getMonday();
  const dates = [];
  for (let i = start; i <= end; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d);
  }
  return dates;
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/** Dismiss any open overlay / modal safely. */
async function dismissOverlay(page) {
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } catch (_) { /* ignore */ }
}

/** Click an element by role+name if it's visible within the timeout. */
async function safeClick(page, role, name, opts = {}) {
  const loc = page.getByRole(role, name);
  await loc.waitFor({ state: 'visible', timeout: opts.timeout || 5000 });
  await loc.click();
}

/** Navigate back to the main Leave list view reliably. */
async function goToLeaveList(page) {
  await dismissOverlay(page);

  // Click "Timetable" breadcrumb to go to dashboard, then "Leave and Gate Pass"
  const timetable = page.locator('span').filter({ hasText: 'Timetable' }).first();
  try {
    await timetable.waitFor({ state: 'visible', timeout: 3000 });
    await timetable.click();
  } catch (_) {
    // Already on dashboard – try clicking "Leave and Gate Pass" directly
  }
  await page.waitForTimeout(800);
  try {
    await page.getByText('Leave and Gate Pass', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
    await page.getByText('Leave and Gate Pass', { exact: true }).click();
  } catch (_) {
    await page.getByText('Leave and Gate Pass').first().click();
  }
  await page.waitForTimeout(1000);
}

// ---------------------------------------------------------------------------
// Date picker
// ---------------------------------------------------------------------------

/**
 * Select a date in the calendar popup.
 *
 * The Camu calendar renders two month-grids side by side.  Cells named
 * after the day number appear in BOTH grids when the day exists in both
 * months.  We must pick the correct grid:
 *
 *   nth(0) = first visible month   (usually current month)
 *   nth(1) = second visible month  (usually next month)
 */
async function pickDate(page, date) {
  const dayNum = date.getDate();
  const today = new Date();
  const targetMonth = date.getMonth();
  const targetYear = date.getFullYear();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();

  // How many months ahead of the current month is our target?
  const monthDiff = (targetYear - currentYear) * 12 + (targetMonth - currentMonth);

  // monthDiff = 0 → current month (nth 0)
  // monthDiff = 1 → next month     (nth 1)
  // monthDiff > 1 → need to navigate forward
  let nthIndex = monthDiff;
  if (monthDiff < 0) nthIndex = 0; // shouldn't happen for this week's dates

  console.log(`  Picking day ${dayNum} (month offset ${monthDiff}, nth=${nthIndex})`);

  // If target is more than 1 month ahead, click "next month" arrows
  if (monthDiff > 1) {
    for (let i = 1; i < monthDiff; i++) {
      try {
        await page.locator('[aria-label="Next month"], .Cal__Header__next, [class*="next"] button').first().click();
        await page.waitForTimeout(300);
      } catch (_) {
        // Fallback: try arrow icons
        try {
          await page.locator('svg[data-testid="ArrowRightIcon"], [data-testid="ArrowRightIcon"]').first().click();
          await page.waitForTimeout(300);
        } catch (_) { /* ignore */ }
      }
    }
    nthIndex = 1; // after navigating, target will be in the second visible grid
  }

  // Wait briefly for the calendar to render
  await page.waitForTimeout(500);

  // Click the correct cell
  const cell = page.getByRole('cell', { name: String(dayNum) }).nth(nthIndex);
  try {
    await cell.waitFor({ state: 'visible', timeout: 5000 });
    await cell.click();
  } catch (err) {
    console.warn(`  nth(${nthIndex}) failed, trying nth(0) as fallback`);
    await page.getByRole('cell', { name: String(dayNum) }).first().click();
  }
  await page.waitForTimeout(400);
}

async function selectStartDate(page, date) {
  await page.getByRole('textbox', { name: 'Start Date' }).click();
  await page.waitForTimeout(600);
  await pickDate(page, date);
}

async function selectEndDate(page, date) {
  await page.getByRole('textbox', { name: 'To Date' }).click();
  await page.waitForTimeout(600);
  await pickDate(page, date);
}

// ---------------------------------------------------------------------------
// Time picker
// ---------------------------------------------------------------------------

/**
 * Click up/down arrows repeatedly on the time picker.
 * The Camu time picker uses ▲/▼ spans; nth index and click count
 * are hard to predict.  We use a generous approach.
 */
async function clickArrow(page, char, nthIndex, times) {
  for (let i = 0; i < times; i++) {
    try {
      await page.getByText(char).nth(nthIndex).click({ timeout: 2000 });
      await page.waitForTimeout(80);
    } catch {
      break; // arrow may have disappeared
    }
  }
}

async function setFromTime(page) {
  await page.locator('input[name="Frtm"]').click();
  await page.waitForTimeout(500);
  await clickArrow(page, '▲', 0, 10);
  await page.waitForTimeout(200);
}

async function setToTime(page) {
  await page.locator('input[name="ToTm"]').click();
  await page.waitForTimeout(500);
  await clickArrow(page, '▼', 3, 4);
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Leave-type dropdown
// ---------------------------------------------------------------------------

/** Open the leave-type dropdown using the exact locator from test recording. */
async function openLeaveTypeDropdown(page) {
  const loc = page.locator('div').filter({ hasText: 'Leave typeoption Leave,' }).nth(5);
  await loc.waitFor({ state: 'visible', timeout: 5000 });
  await loc.click();
}

async function selectLeaveTypeOption(page, typeName) {
  await page.getByRole('option', { name: typeName }).click();
  await page.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// Main flows
// ---------------------------------------------------------------------------

async function login(page) {
  console.log('Logging in...');
  await page.goto('https://student.camu.in/#/');
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  await page.getByRole('textbox', { name: 'Type your institution name' }).click();
  await page.getByRole('textbox', { name: 'Type your institution name' }).fill(CREDENTIALS.institution);
  await page.getByText(CREDENTIALS.institutionName).click();
  await page.locator('input[name="Email"]').click();
  await page.locator('input[name="Email"]').fill(CREDENTIALS.email);
  await page.locator('input[name="pwd"]').click();
  await page.locator('input[name="pwd"]').fill(CREDENTIALS.password);
  await page.getByRole('button', { name: 'Login' }).click();

  // Wait for dashboard to load
  await page.waitForTimeout(2000);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  console.log('Logged in.');
}

async function applyLeaveForDay(page, date) {
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = date.toLocaleDateString('en-IN');
  console.log(`\n=== ${dayName} (${dateStr}) ===`);

  // Navigate to leave application form
  await goToLeaveList(page);

  console.log('  Opening application form...');
  await page.getByRole('button', { name: 'Apply Leave and Gate Pass' }).click();
  await page.waitForTimeout(800);

  // Select "Leave" in the first dropdown
  console.log('  Selecting "Leave" type...');
  try {
    await page.locator(
      '.rs-option__control.css-1vlf9f8-control > .rs-option__value-container > .rs-option__input-container',
    ).first().click();
  } catch {
    await page.locator('[class*="select__control"]').first().click();
  }
  await page.waitForTimeout(400);
  await page.getByRole('option', { name: 'Leave', exact: true }).click();
  await page.waitForTimeout(300);

  // Date selection
  console.log('  Setting dates...');
  await selectStartDate(page, date);
  await dismissOverlay(page);
  await page.waitForTimeout(200);

  await selectEndDate(page, date);
  await dismissOverlay(page);
  await page.waitForTimeout(200);

  // Check the checkbox
  console.log('  Filling details...');
  await page.getByRole('checkbox').nth(2).check();

  // --- From Time (BEFORE leave sub-type, matching the recording) ---
  console.log('  Setting From Time...');
  await setFromTime(page);
  await dismissOverlay(page);
  await page.waitForTimeout(300);

  // --- Leave sub-type: "Week End Gate Pass" ---
  console.log('  Selecting "Week End Gate Pass"...');
  await openLeaveTypeDropdown(page);
  await page.waitForTimeout(500);
  await selectLeaveTypeOption(page, 'Week End Gate Pass');
  await page.waitForTimeout(300);

  // --- To Time (AFTER leave sub-type, matching the recording) ---
  console.log('  Setting To Time...');
  await setToTime(page);
  await dismissOverlay(page);
  await page.waitForTimeout(300);

  // --- Click leave-type dropdown again (matches recording line 40) ---
  await openLeaveTypeDropdown(page);
  await page.waitForTimeout(300);

  // Reason
  console.log('  Filling reason...');
  await page.getByRole('textbox', { name: 'Reason for Absence' }).click();
  await page.getByRole('textbox', { name: 'Reason for Absence' }).fill('outing');
  await page.waitForTimeout(200);

  // Save
  console.log('  Saving...');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(3000);
  await dismissOverlay(page);
}

async function approveLeave(page, date) {
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
  console.log(`  Approving ${dayName}...`);

  // Navigate back to leave list
  await goToLeaveList(page);

  // Open options menu for the latest entry
  try {
    await page.getByRole('button', { name: 'more_horiz', description: 'Options' }).first().click({ timeout: 5000 });
  } catch {
    await page.getByRole('button', { name: 'more_horiz' }).first().click();
  }
  await page.waitForTimeout(500);

  // Click Status → Approve → Confirm
  await page.getByRole('button', { name: 'Status' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Approve' }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Approve' }).nth(1).click();
  await page.waitForTimeout(1500);
}

async function applyAndApproveForDay(page, date) {
  await applyLeaveForDay(page, date);
  await approveLeave(page, date);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

(async () => {
  if (!CREDENTIALS.email || !CREDENTIALS.password) {
    console.error('Missing CAMU_EMAIL or CAMU_PASSWORD in .env');
    process.exit(1);
  }

  const browser = await firefox.launch({ headless: false, slowMo: 150 });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await login(page);

    const dates = parseDayRange(process.argv);
    for (const date of dates) {
      await applyAndApproveForDay(page, date);
    }

    console.log('\n✅ All outings applied and approved!');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    console.log('Closing browser...');
    await browser.close();
  }
})();
