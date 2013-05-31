$(document).ready(function() {
    try {

        console.log($("[rel=popover]"));

        //Popovers!
        $("[rel=popover]")
            .popover({
                offset: 10
            })
            .click(function(e) {
                e.preventDefault()
            });
    } catch(err) {}
});
