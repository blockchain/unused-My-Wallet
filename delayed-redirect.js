$(document).ready(function() {
    setTimeout(function() {
        window.location = $(document.body).data('url');

    }, parseInt($(document.body).data('time')))
});