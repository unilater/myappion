import { Component, AfterViewInit } from '@angular/core';

declare var paypal: any;

@Component({
  selector: 'app-paypal',
  templateUrl: './paypal.page.html',
  styleUrls: ['./paypal.page.scss'],
})
export class PaypalPage implements AfterViewInit {

  ngAfterViewInit() {
    this.loadPaypalScript().then(() => {
      paypal.Buttons({
        createOrder: (data, actions) => {
          return actions.order.create({
            purchase_units: [{
              amount: {
                value: '10.00' // importo da pagare
              }
            }]
          });
        },
        onApprove: (data, actions) => {
          return actions.order.capture().then(details => {
            alert('Transaction completed by ' + details.payer.name.given_name);
            // Qui puoi aggiungere la logica di conferma pagamento, aggiornamento backend, ecc.
          });
        },
        onError: (err) => {
          console.error('PayPal Checkout error:', err);
          alert('Payment could not be processed.');
        }
      }).render('#paypal-button-container');
    });
  }

  loadPaypalScript(): Promise<void> {
    return new Promise((resolve) => {
      if (document.getElementById('paypal-sdk')) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.id = 'paypal-sdk';
      script.src = 'https://www.paypal.com/sdk/js?client-id=AVZb6uXtSyfPFWCeG8VGki1KL_Z1zX_CZSSnUV-Qk6TPddwNbNQP0sA9JlziomB-IZ_2XESbZTkIUWsw&currency=EUR'; // sostituisci TUO_CLIENT_ID
      script.onload = () => resolve();
      document.body.appendChild(script);
    });
  }
}
