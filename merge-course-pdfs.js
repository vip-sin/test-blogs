const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

// Run once: npm install pdf-lib

async function mergeCoursePDFs() {
    const baseFolder = 'course_pdfs';

    if (!fs.existsSync(baseFolder)) {
        console.log('❌ course_pdfs folder not found!');
        return;
    }

    const courses = fs.readdirSync(baseFolder).filter(item => 
        fs.statSync(path.join(baseFolder, item)).isDirectory()
    );

    console.log(`Found ${courses.length} courses to merge.\n`);

    for (const courseName of courses) {
        const coursePath = path.join(baseFolder, courseName);
        const pdfFiles = fs.readdirSync(coursePath)
            .filter(file => file.toLowerCase().endsWith('.pdf') && !file.includes('_FULL.pdf'))
            .sort();   // Ensures correct order: 01_, 02_, etc.

        if (pdfFiles.length === 0) continue;

        console.log(`Merging ${pdfFiles.length} sections for: ${courseName}`);

        const mergedPdf = await PDFDocument.create();
        const helveticaBold = await mergedPdf.embedFont(StandardFonts.HelveticaBold);
        const helvetica = await mergedPdf.embedFont(StandardFonts.Helvetica);

        const pageNumbers = [];   // To store destination page numbers for TOC

        // Step 1: Add all content pages and record their page numbers
        for (const file of pdfFiles) {
            const filePath = path.join(coursePath, file);
            const pdfBytes = fs.readFileSync(filePath);
            const sourcePdf = await PDFDocument.load(pdfBytes);

            const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
            copiedPages.forEach(page => mergedPdf.addPage(page));

            pageNumbers.push(mergedPdf.getPageCount() - copiedPages.length); // starting page of this section
            console.log(`   Added: ${file}`);
        }

        // Step 2: Create Table of Contents as first page
        const tocPage = mergedPdf.insertPage(0);
        const { width, height } = tocPage.getSize();

        // Title
        tocPage.drawText(courseName.replace(/_/g, ' '), {
            x: 50,
            y: height - 80,
            size: 24,
            font: helveticaBold,
            color: rgb(0, 0.3, 0.6)
        });

        tocPage.drawText('Table of Contents', {
            x: 50,
            y: height - 120,
            size: 18,
            font: helveticaBold,
            color: rgb(0, 0, 0)
        });

        // Draw clickable index
        let y = height - 180;
        for (let i = 0; i < pdfFiles.length; i++) {
            const sectionName = pdfFiles[i]
                .replace(/^\d+_/,'')
                .replace('.pdf','')
                .replace(/_/g, ' ');

            // Draw section name
            tocPage.drawText(`${(i+1).toString().padStart(2,'0')}. ${sectionName}`, {
                x: 60,
                y: y,
                size: 14,
                font: helvetica,
                color: rgb(0, 0, 0)
            });

            // Make it clickable (link to the section page)
            const linkRect = { x: 50, y: y - 5, width: width - 100, height: 20 };
            tocPage.drawRectangle({
                x: linkRect.x,
                y: linkRect.y,
                width: linkRect.width,
                height: linkRect.height,
                borderColor: rgb(0.2, 0.6, 1),
                borderWidth: 1,
                opacity: 0.1
            });

            // Add link annotation
            const link = tocPage.createLinkAnnotation({
                uri: '', // internal link
                rect: linkRect
            });
            link.setDestination(mergedPdf.getPage(pageNumbers[i] + 1)); // +1 because TOC is page 0
            tocPage.addLinkAnnotation(link);

            y -= 35;
            if (y < 80) break; // safety
        }

        // Save the final merged PDF
        const outputPath = path.join(coursePath, `${courseName}_FULL.pdf`);
        const mergedBytes = await mergedPdf.save();

        fs.writeFileSync(outputPath, mergedBytes);

        console.log(`✅ Created clickable merged PDF: ${courseName}_FULL.pdf\n`);
    }

    console.log('🎉 All courses have been merged with a clickable Table of Contents!');
}

mergeCoursePDFs().catch(console.error);