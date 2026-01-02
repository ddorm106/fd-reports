// ===============================================
// Centerville FD - Main JavaScript (Clean & Production-Ready)
// For use with index.html and report pages
// ===============================================

// Minimal Service Worker (for future PWA install prompt)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')  // Create a separate sw.js file
        .then(reg => console.log('Service Worker registered', reg))
        .catch(err => console.log('Service Worker registration failed', err));
}

// Main app logic
document.addEventListener('DOMContentLoaded', () => {
    console.log('Centerville FD system loaded successfully!');

    // === File Upload Handler (Upload Training Sheets card) ===
    const fileInput = document.getElementById('file-upload');
    const uploadTrigger = document.querySelector('.upload-trigger');
    const statusDiv = document.getElementById('upload-status'); // Optional: add <div id="upload-status"></div> in HTML

    if (uploadTrigger && fileInput) {
        // Open file picker when clicking the styled button
        uploadTrigger.addEventListener('click', (e) => {
            e.preventDefault();
            fileInput.click();
        });

        // Handle file selection and show user feedback
        fileInput.addEventListener('change', () => {
            const files = fileInput.files;
            if (files.length === 0) {
                if (statusDiv) statusDiv.textContent = '';
                return;
            }

            let message = `${files.length} file${files.length > 1 ? 's' : ''} selected:\n\n`;
            for (let file of files) {
                const sizeKB = (file.size / 1024).toFixed(1);
                message += `• ${file.name} (${sizeKB} KB)\n`;
            }
            message += `\nFiles ready for upload.`;

            alert(message);
            console.log('Selected files:', files);

            // Optional: Show feedback on page instead of alert
            if (statusDiv) {
                let html = `<strong>${files.length} file${files.length > 1 ? 's' : ''} selected:</strong><br>`;
                for (let file of files) {
                    const sizeKB = (file.size / 1024).toFixed(1);
                    html += `• ${file.name} (${sizeKB} KB)<br>`;
                }
                statusDiv.innerHTML = html;
                statusDiv.style.color = '#f59e0b';
            }
        });
    } else {
        console.warn('Upload elements not found. Check IDs: file-upload and .upload-trigger');
    }

    // === Future Features Placeholder ===
    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.querySelector(anchor.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });

    // Add more features here later:
    // - Dark/light mode toggle
    // - Offline detection
    // - PWA install prompt
    // - Form validation
});
