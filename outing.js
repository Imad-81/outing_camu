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

async function clickArrow(page, char, index, times) {
  for (let i = 0; i < times; i++) {
    await page.getByText(char).nth(index).click();
    await page.waitForTimeout(100);
  }
}

async function dismissPageOverlay(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.mouse.click(5, 5);
  await page.waitForTimeout(300);
}

async function setTimeFrom(page) {
  await page.locator('input[name="Frtm"]').click();
  await page.waitForTimeout(500);
  await clickArrow(page, '▲', 0, 8);
  await dismissPageOverlay(page);
}

async function setTimeTo(page) {
  await page.locator('input[name="ToTm"]').click();
  await page.waitForTimeout(500);
  await clickArrow(page, '▼', 3, 3);
  await dismissPageOverlay(page);
}

async function applyAndApproveForDay(page, date) {
  const dayNum = date.getDate();
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = date.toLocaleDateString('en-IN');
  console.log(`\n--- ${dayName} (${dateStr}) ---`);

  await page.getByText('Leave and Gate Pass', { exact: true }).click();
  await page.waitForTimeout(1000);

  await page.getByRole('button', { name: 'Apply Leave and Gate Pass' }).click();
  await page.waitForTimeout(500);

  await page.locator('.rs-option__control.css-1vlf9f8-control > .rs-option__value-container > .rs-option__input-container').first().click();
  await page.getByRole('option', { name: 'Leave', exact: true }).click();

  await page.getByRole('textbox', { name: 'Start Date' }).click();
  await page.getByRole('cell', { name: String(dayNum) }).nth(1).click();

  await page.getByRole('textbox', { name: 'To Date' }).click();
  await page.getByRole('cell', { name: String(dayNum) }).nth(1).click();

  await page.getByRole('checkbox').nth(2).check();

  await setTimeFrom(page);
  await setTimeTo(page);

  await page.locator('div').filter({ hasText: 'Leave typeoption Leave,' }).nth(5).click();
  await page.getByRole('option', { name: 'Week End Gate Pass' }).click();
  await page.locator('div').filter({ hasText: 'Leave typeoption Leave,' }).nth(5).click();

  await page.getByRole('textbox', { name: 'Reason for Absence' }).click();
  await page.getByRole('textbox', { name: 'Reason for Absence' }).fill('outing');

  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(2000);

  await dismissPageOverlay(page);
  await page.locator('span').filter({ hasText: 'Timetable' }).first().click();
  await page.waitForTimeout(500);
  await page.getByText('Leave and Gate Pass', { exact: true }).click();
  await page.waitForTimeout(500);
  await dismissPageOverlay(page);
  await page.getByRole('button', { name: 'more_horiz', description: 'Options' }).click();
  await page.getByRole('button', { name: 'Status' }).click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('button', { name: 'Approve' }).nth(1).click();
  await page.waitForTimeout(1000);
}

(async () => {
  if (!CREDENTIALS.email || !CREDENTIALS.password) {
    console.error('Missing CAMU_EMAIL or CAMU_PASSWORD in .env');
    process.exit(1);
  }

  const browser = await firefox.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('https://student.camu.in/#/');
    await page.getByRole('textbox', { name: 'Type your institution name' }).click();
    await page.getByRole('textbox', { name: 'Type your institution name' }).fill(CREDENTIALS.institution);
    await page.getByText(CREDENTIALS.institutionName).click();
    await page.locator('input[name="Email"]').click();
    await page.locator('input[name="Email"]').fill(CREDENTIALS.email);
    await page.locator('input[name="pwd"]').click();
    await page.locator('input[name="pwd"]').fill(CREDENTIALS.password);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForTimeout(3000);

    const dates = parseDayRange(process.argv);
    for (const date of dates) {
      await applyAndApproveForDay(page, date);
    }

    console.log('\nAll outings applied and approved!');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
})();
