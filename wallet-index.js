$(document).ready(function() {	
	
	try {
		$('.slidedeck').slidedeck();
	
		//Popovers! 
		$(function () {
		 $("a[rel=popover]")
		   .popover({
		     offset: 10
		   })
		   .click(function(e) {
		     e.preventDefault()
		   });
		});
	} catch(err) {}
	
	$('#sms-depost-button').click(function() {
		loadScript('./deposit/deposit.js', function() {
			showDepositModal($('#sms-depost-address').val());
		});
	});
	
	$('#youtube-preview').click(function() {
		$('#youtube-preview').empty();
		
		$('#youtube-preview').append('<iframe width="100%" height="256" src="https://www.youtube.com/embed/Um63OQz3bjo?autohide=1&controls=0&showinfo=0&autoplay=1" frameborder="0" allowfullscreen></iframe>');
	});
	

	
	$('#forgot-email-btn').click(function() {
		window.location = root + 'wallet/forgot-identifier?email='+ $('#forgot-email').val();
	});
	
	//Uservoice
	setTimeout(function() {
		$('head').append('<script type="text/javascript" src="https://widget.uservoice.com/4wr7K1dKGPbvxshWQTrTg.js"></script>');		
	}, 1000);
});