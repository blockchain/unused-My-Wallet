$(document).ready(function() {
    isInitialized = true;

    setTimeout(function() {
        try {
            setDoubleEncryptionButton();

            bindAccountButtons();

            getAccountInfo();
        } catch (e) {
            makeNotice('error', 'misc-error', 'Fatal Error ' + e);
        }
    }, 500);
});