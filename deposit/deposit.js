function showDepositModal(address) {
	loadScript(resource + 'wallet/bootstrap-modal.js', function () {

		$('body').append('<div id="frame-modal" class="modal hide fade" style="width:100%;max-width:700px;"><div class="modal-header"><a href="#" class="close">&times;</a><h3>Instant Bitcoin Deposit</h3></div><div class="modal-body"><iframe src="/deposit?address='+address+'" border="0" scrolling="no" style="overflow-y:hidden;border-style:none;width:100%;height:325px"></iframe></div><div class="modal-footer"><a class="btn secondary">Close</a></div></div>');

		var modal = $('#frame-modal');

		modal.modal({
			keyboard: true,
			backdrop: "static",
			show: true
		});

		modal.find('.btn.primary').unbind().click(function() {
			modal.modal('hide');
		});

		modal.find('.btn.secondary').unbind().click(function() {
			modal.modal('hide');
		});

		if (modal.center)
			modal.center();
	});
}