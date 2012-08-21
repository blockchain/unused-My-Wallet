
$.fn.center = function () {
    this.css("top", Math.max(( $(window).height() - this.height() ) / 2+$(window).scrollTop(), 10) + "px");
    this.css("left", Math.max(( $(window).width() - this.width() ) / 2+$(window).scrollLeft(), 10) + "px");
    return this;
};

$(window).resize(function() {
    $('.modal:visible').center();
});

function showPaymentRequestModal(address, title) {
	loadScript(resource + 'wallet/bootstrap.min.js', function () {

		$('#request-payment-modal').remove();
		
		if ($('#request-payment-modal').length == 0)
			$('body').append('<div id="request-payment-modal" class="modal hide" style="width:100%;max-width:700px;"><div class="modal-header"><button type="button" class="close" data-dismiss="modal">×</button><h3>'+title+'</h3></div><div class="modal-body"><iframe id="request-payment-frame" border="0" scrolling="no" style="overflow-y:hidden;border-style:none;width:100%;height:400px"></iframe></div><div class="modal-footer btn-group">Request Payment into address <b>'+address+'</b> <a class="btn btn-secondary">Close</a></div></div>');

		var modal = $('#request-payment-modal');

		modal.modal({
			keyboard: true,
			backdrop: "static",
			show: true
		});

		modal.find('.btn.btn-primary').unbind().click(function() {
			modal.modal('hide');
		});

		modal.find('.btn.btn-secondary').unbind().click(function() {
			modal.modal('hide');
		});

	    modal.center();
		
		$('#request-payment-frame').attr('src', '/payment_request?address='+address);
	});
}