function showDepositBankModal(address) {
	loadScript(resource + 'wallet/bootstrap-modal.js', function () {

		$('#bank-deposit-modal').remove();
		
		$('body').append('<div id="bank-deposit-modal" class="modal hide fade" style="width:100%;max-width:700px;"><div class="modal-header"><a href="#" class="close">&times;</a><h3>Deposit Using Bank Transfer</h3></div><div class="modal-body"><center><iframe src="http://wallapi.com/api/ps/?key=d8966968cea4162c37809bc472f09ad0&uid='+address+'&widget=p4_1" width="371" height="450" frameborder="0"></iframe></center></div><div class="modal-footer">Deposit Bitcoin into address <b>'+address+'</b> <a class="btn secondary">Close</a></div></div>');

		var modal = $('#bank-deposit-modal');

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