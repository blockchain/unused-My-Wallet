function showDepositModal(address, method, title) {
	loadScript(resource + 'wallet/bootstrap-modal.js', function () {

		$('#deposit-modal').remove();
		
		if ($('#deposit-modal').length == 0)
			$('body').append('<div id="deposit-modal" class="modal hide fade" style="width:100%;max-width:700px;"><div class="modal-header"><a href="#" class="close">&times;</a><h3>'+title+'</h3></div><div class="modal-body"><iframe id="deposit-frame" border="0" scrolling="no" style="overflow-y:hidden;border-style:none;width:100%;height:425px"></iframe></div><div class="modal-footer">Deposit Bitcoin into address <b>'+address+'</b> <a class="btn secondary">Close</a></div></div>');

		var modal = $('#deposit-modal');

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
		
		$('#deposit-frame').attr('src', '/deposit?address='+address+'&ptype='+method);
	});
}