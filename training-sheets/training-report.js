// training-report.js
// EmailJS init – keep this in your HTML <head>
// <script type="text/javascript">
//     (function(){ emailjs.init("0149jkoCQjJZn6JwD"); })();
// </script>

// Auto-calculate Total Hours
function calculateTotalHours() {
    const startH = parseInt(document.getElementById('start-hour').value) || 0;
    const startM = parseInt(document.getElementById('start-minute').value) || 0;
    const endH = parseInt(document.getElementById('end-hour').value) || 0;
    const endM = parseInt(document.getElementById('end-minute').value) || 0;

    if (startH >= 0 && startM >= 0 && endH >= 0 && endM >= 0 && (startH || startM || endH || endM)) {
        let hours = endH - startH;
        let minutes = endM - startM;
        if (minutes < 0) { minutes += 60; hours--; }
        if (hours < 0) { hours += 24; }
        const total = hours + minutes / 60;
        document.getElementById('total-hours').value = total.toFixed(1);
    } else {
        document.getElementById('total-hours').value = '';
    }
}
['start-hour', 'start-minute', 'end-hour', 'end-minute'].forEach(id => {
    document.getElementById(id).addEventListener('input', calculateTotalHours);
});

// Shift Buttons
function toggleShift(id) {
    document.getElementById(id).classList.toggle('selected');
    updateSelectedShifts();
}
function updateSelectedShifts() {
    const selected = Array.from(document.querySelectorAll('.shift-btn.selected'))
        .map(btn => btn.textContent.trim())
        .join(', ');
    document.getElementById('selected-shifts').value = selected;
}

// Copy Textarea
function copyTextarea(id) {
    const textarea = document.getElementById(id);
    navigator.clipboard.writeText(textarea.value);
    const feedback = document.getElementById(id + '-feedback');
    feedback.style.opacity = 1;
    setTimeout(() => feedback.style.opacity = 0, 1500);
}

// Other Personnel Toggle
document.getElementById('other-personnel-toggle').addEventListener('click', () => {
    const toggle = document.getElementById('other-personnel-toggle');
    const section = document.getElementById('outside-students-section');
    toggle.classList.toggle('active');
    section.style.display = toggle.classList.contains('active') ? 'block' : 'none';
});

// ISO Category Auto-Fill
const driverDescriptions = {
    'Driver (Roadway)': {
        desc: "Firefighter driver training is a comprehensive program designed to equip emergency personnel with the knowledge, skills, and judgment to operate large, heavy fire apparatus safely and efficiently in emergency and non-emergency situations. This training emphasizes safety through accident avoidance and adherence to legal requirements.",
        obj: `- Maneuvering large vehicles, including backing up and parallel parking with limited visibility\n- Negotiating narrow streets, sharp turns, and intersections safely\n- Defensive driving techniques and collision avoidance\n- Operating the vehicle under various weather and road conditions`
    },
    'Driver (Area Familiarization)': {
        desc: "Area familiarization training for firefighters is a continuous and proactive process designed to ensure that crews possess intimate knowledge of their first-due response area and the specific structures within it. This knowledge enhances situational awareness, improves response times, and is critical for both public and firefighter safety during emergencies.",
        obj: `- Ensuring knowledge of street locations and optimal response routes\n- Locating water sources\n- Identifying target hazards\n- Understanding building construction types\n- Familiarization with a building's fire suppression and alarm system\n- Locating critical access points`
    }
};

document.getElementById('iso-category').addEventListener('change', function () {
    const selected = this.value;
    const driversSection = document.getElementById('drivers-training-section');
    const desc = document.getElementById('description');
    const obj = document.getElementById('objectives');

    const driverCategories = ['Driver (Roadway)', 'Driver (Pumper Training)', 'Driver (Aerial Training)'];
    driversSection.style.display = driverCategories.includes(selected) ? 'block' : 'none';

    if (driverDescriptions[selected]) {
        desc.value = driverDescriptions[selected].desc;
        obj.value = driverDescriptions[selected].obj;
    } else {
        desc.value = '';
        obj.value = '';
    }
});

// Prevent default form submit
document.getElementById('trainingForm').addEventListener('submit', e => {
    e.preventDefault();
    alert('Use the "Print / Save as PDF" button to generate and send the report.');
});

// === MAIN: Generate Small PDF + Download + Auto-Email ===
document.querySelector('.print-btn').addEventListener('click', async () => {
    const container = document.querySelector('.container');

    // Temporary clean styles for PDF
    const style = document.createElement('style');
    style.innerHTML = `
        button, .copy-btn, .sign-btn, .remove-btn, .remove-grading-btn,
        .remove-equipment-btn, #add-instructor, #add-student-centerville,
        #add-student-outside, #add-grading-point, #add-equipment,
        #other-personnel-toggle, .damaged-buttons, .copy-wrapper {
            display: none !important;
        }
        input, select, textarea {
            border: none !important;
            border-bottom: 1px solid #000 !important;
            background: transparent !important;
            color: #000 !important;
            padding: 4px 0;
        }
        .table th, .table td { border: 1px solid #000 !important; }
        .signature-display { border: 1px solid #000; background: #f8f8f8; }
    `;
    document.head.appendChild(style);

    try {
        // Render canvas with aggressive size reduction
        const canvas = await html2canvas(container, {
            scale: 1.4,              // Small but readable
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false,
            allowTaint: true
        });

        // Create highly compressed PDF
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'pt',
            format: 'letter',
            compress: true
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.65);  // Balanced quality/size

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const ratio = Math.min(pdfWidth / canvas.width, pdfHeight / canvas.height);

        pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width * ratio, canvas.height * ratio, undefined, 'FAST');

        // Generate blob and download
        const pdfBlob = pdf.output('blob');
        const url = URL.createObjectURL(pdfBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'Centerville_Training_Report.pdf';
        link.click();

        // Debug size (remove later if desired)
        console.log('Raw PDF size:', (pdfBlob.size / 1024).toFixed(1), 'KB');

        // Auto-send email
        const FIXED_RECIPIENT = 'ddorman@centervillefd.com';

        const reader = new FileReader();
        reader.onload = function () {
            const base64Pdf = reader.result.split(',')[1];
            console.log('Base64 size estimate:', ((base64Pdf.length * 3 / 4) / 1024).toFixed(1), 'KB');

            emailjs.send('service_2gdxvws', 'template_wj80wlx', {
                to_email: FIXED_RECIPIENT,
                to_name: "David Dorman",
                training_title: document.getElementById('training-title').value || "Untitled Training",
                date: document.getElementById('date').value || "",
                selected_shifts: document.getElementById('selected-shifts').value || "N/A",
                location: document.getElementById('location').value || "N/A",
                iso_category: document.getElementById('iso-category').options[document.getElementById('iso-category').selectedIndex]?.text || "N/A",
                from_name: 'Centerville FD Training System',
                message: 'A new training report has been submitted and is attached.',
                attachment: base64Pdf,
                filename: 'Centerville_Training_Report.pdf'
            })
            .then(() => {
                alert('✅ Report generated and emailed to ' + FIXED_RECIPIENT);
            })
            .catch(err => {
                console.error('EmailJS Error:', err);
                alert('⚠️ PDF saved, but email failed. Check console.\nError: ' + (err.text || JSON.stringify(err)));
            });
        };
        reader.readAsDataURL(pdfBlob);

    } catch (err) {
        console.error('PDF Generation Error:', err);
        alert('Failed to generate PDF. Check console.');
    } finally {
        document.head.removeChild(style);
    }
});