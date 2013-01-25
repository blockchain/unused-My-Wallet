
$.fn.center = function () {
    this.css("top", Math.max(( $(window).height() - this.height() ) / 2+$(window).scrollTop(), 10) + "px");
    this.css("left", Math.max(( $(window).width() - this.width() ) / 2+$(window).scrollLeft(), 10) + "px");
    return this;
};

$(window).resize(function() {
    $('.modal:visible').center();
});

function showFrameModal(options) {
    var modal = $('#frame-modal');

    var top_right = '';
    if (options.top_right) {
        top_right = '<span style="float:right;padding-top:5px;padding-right:10px;">'+options.top_right+'</a></span>'
    }

    try {
        modal.modal('hide');

        modal.remove();
    } catch (e) {
        console.log(e);
    }

    $('body').append('<div id="frame-modal" class="modal hide"><div class="modal-header"><button type="button" class="close" data-dismiss="modal">×</button>'+top_right+'<h3>'+options.title+'</h3></div><div class="modal-body" style="overflow-y:hidden;"><iframe border="0" scrolling="auto" style="overflow-y:hidden;border-style:none;"></iframe></div><div class="modal-footer btn-group">'+options.description+' <a class="btn btn-secondary">Close</a></div></div>');

    modal = $('#frame-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });


    try { hidePopovers() } catch(e) {};

    if (options.width) {
        modal.find('.modal-body').css('width', options.width);
    }

    if (options.height) {
        modal.find('iframe').css('height', options.height);
    }

    modal.find('.btn.btn-primary').unbind().click(function() {
        modal.modal('hide');
    });

    modal.find('.btn.btn-secondary').unbind().click(function() {
        modal.modal('hide');
    });

    modal.find('iframe').attr('src', options.src);

    modal.center();
}