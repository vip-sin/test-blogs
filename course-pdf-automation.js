const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://{process.env.TEST_BLOG}.com';
const MY_COURSES_URL = `${BASE_URL}/my-courses`;

const COURSE_CARD_SELECTOR = 'li[class*="courseItem"], li.style_courseItem__MV4Ic';
const COMING_SOON_SELECTOR = '[class*="comingSoon"]';

const MENU_ITEMS_SELECTOR = 'ul.ant-menu li.ant-menu-item';
const CONTENT_SELECTOR = '#content.style_articleWrap__Xn2yv';

const PDF_OUTPUT_FOLDER = 'course_pdfs';

async function acceptCookies(page) {
    try {
        const selectors = ['button:has-text("Accept")', 'button:has-text("Accept All")', '#cky-btn-accept', '.cky-accept-button'];
        for (const sel of selectors) {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 3000 })) {
                await btn.click();
                console.log('🍪 Cookies accepted');
                await page.waitForTimeout(800);
                return;
            }
        }
    } catch (e) {}
}

async function isolateDivAndPrintPDF(page, selector, pdfPath) {
    await page.evaluate((sel) => {
        const target = document.querySelector(sel);
        if (!target) return;

        const toHide = [
            'aside.ant-layout-sider',
            'header.ant-layout-header',
            'footer.style_footer__12Jjr',
            '.style_chatButtonContainer__NAl07',
            '.style_markCompleteWrap__YEi4w'
        ];

        toHide.forEach(s => {
            document.querySelectorAll(s).forEach(el => {
                if (el) el.style.setProperty('display', 'none', 'important');
            });
        });

        target.style.position = 'absolute';
        target.style.left = '0';
        target.style.top = '0';
        target.style.width = '100%';
        target.style.margin = '0 auto';
        target.style.padding = '40px 50px';
        target.style.backgroundColor = 'white';

        const article = target.querySelector('article.style_learnContent__K5K7M');
        if (article) article.style.maxWidth = '820px';
    }, selector);

    await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '1cm', bottom: '1cm', left: '1.2cm', right: '1.2cm' }
    });

    console.log(`✅ Saved: ${path.basename(pdfPath)}`);
}

async function main() {
    if (!fs.existsSync(PDF_OUTPUT_FOLDER)) fs.mkdirSync(PDF_OUTPUT_FOLDER);

    const browser = await chromium.launch({ 
        headless: false, 
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] 
    });

    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();

    console.log('🌐 Opening login page...');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });

    console.log('\n=== MANUAL GOOGLE LOGIN ===');
    console.log('1. Sign in with Google');
    console.log('2. After login, press ENTER here...');

    await new Promise(resolve => process.stdin.once('data', resolve));

    console.log('\n✅ Login done. Going to My Courses...');
    await page.goto(MY_COURSES_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    await acceptCookies(page);

    const courseCards = await page.locator(COURSE_CARD_SELECTOR).all();
    console.log(`Found ${courseCards.length} course cards.`);

    for (let i = 0; i < courseCards.length; i++) {
        const card = courseCards[i];

        if (await card.locator(COMING_SOON_SELECTOR).count() > 0) {
            console.log(`⏭️ Skipping Coming Soon course`);
            continue;
        }

        let courseTitle = `Course_${i+1}`;
        try {
            const img = await card.locator('img[alt]').first();
            courseTitle = await img.getAttribute('alt') || courseTitle;
            courseTitle = courseTitle.replace(/[^a-zA-Z0-9\s]/g, '_').replace(/_+/g, '_').trim();
        } catch (e) {}

        // Create folder for this course
        const courseFolder = path.join(PDF_OUTPUT_FOLDER, courseTitle);
        if (!fs.existsSync(courseFolder)) fs.mkdirSync(courseFolder);

        console.log(`\n📚 Processing course: ${courseTitle} → Folder created`);

        await card.scrollIntoViewIfNeeded();
        await card.click();
        await page.waitForTimeout(4500);
        await acceptCookies(page);

        // Collect BOTH top-level items AND sub-menu items
        const allMenuLocators = [
            ...await page.locator('ul.ant-menu > li.ant-menu-item').all(),           // Top level
            ...await page.locator('ul.ant-menu-sub > li.ant-menu-item').all()        // Sub sections
        ];

        console.log(`   → Found ${allMenuLocators.length} total sections (including sub-sections)`);

        // Optional: Expand all submenus first to make sure everything is visible
        const submenus = await page.locator('li.ant-menu-submenu').all();
        for (const submenu of submenus) {
            try {
                const arrow = submenu.locator('.ant-menu-submenu-arrow');
                if (await arrow.isVisible()) {
                    await arrow.click();
                    await page.waitForTimeout(800);
                }
            } catch (e) {}
        }

        // Now process all menu items (top + sub)
        for (let j = 0; j < allMenuLocators.length; j++) {
            const item = allMenuLocators[j];

            let sectionTitle = `Section_${j + 1}`;
            try {
                const textEl = await item.locator('strong, span').first();
                sectionTitle = (await textEl.textContent()) || sectionTitle;
                sectionTitle = sectionTitle.trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
            } catch (e) {}

            console.log(`      → ${sectionTitle}`);

            try {
                await item.scrollIntoViewIfNeeded({ timeout: 10000 });
                await item.click({ timeout: 10000 });
            } catch (e) {
                console.log(`        Retrying click with force...`);
                await page.waitForTimeout(1000);
                await item.click({ force: true });
            }

            await page.waitForTimeout(2800);

            const pdfName = `${(j + 1).toString().padStart(2, '0')}_${sectionTitle}.pdf`;
            const pdfPath = path.join(courseFolder, pdfName);

            await isolateDivAndPrintPDF(page, CONTENT_SELECTOR, pdfPath);

            // Reload after each print (except last)
            if (j < allMenuLocators.length - 1) {
                console.log('      Reloading to restore sidebar...');
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(3000);
                await acceptCookies(page);
            }
        }
        
        // Return to My Courses list for next course
        if (i < courseCards.length - 1) {
            console.log('   Returning to My Courses list...');
            await page.goto(MY_COURSES_URL, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(3500);
        }
    }

    console.log('\n🎉 ALL DONE! PDFs are organized by course folders inside "course_pdfs".');
}

main().catch(err => console.error('Error:', err));