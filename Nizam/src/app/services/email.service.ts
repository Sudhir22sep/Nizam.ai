import { SESClient, SendEmailCommand, SendEmailCommandInput } from '@aws-sdk/client-ses';

export class EmailService {
  static sesClient: SESClient | null = null;

  static async sendOrderConfirmation(
    email: string,
    orderData: any
  ): Promise<boolean> {
    if (!EmailService.sesClient) {
      throw new Error('SES client not initialized. Call EmailService.initialize() first.');
    }

    const emailParams: SendEmailCommandInput = {
      Source: process.env.SES_VERIFIED_SENDER!,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: 'Order Confirmation' },
        Body: {
          Text: { Data: this.buildOrderConfirmationText(orderData) },
          Html: { Data: this.buildOrderConfirmationHtml(orderData) },
        },
      },
    };

    try {
      const command = new SendEmailCommand(emailParams);
      await EmailService.sesClient.send(command);
      console.log(`Order confirmation email sent to ${email}`);
      return true;
    } catch (error) {
      console.error('Failed to send order confirmation email:', error);
      return false;
    }
  }

  private static buildOrderConfirmationText(orderData: any): string {
    return `Thank you for your order, ${orderData.name}!\n
Order reference: ${orderData.orderReference}\n
Total: $${orderData.total.toFixed(2)}\n
We will ship your order shortly.`;
  }

  private static buildOrderConfirmationHtml(orderData: any): string {
    return `
      <p>Thank you for your order, <strong>${orderData.name}</strong>!</p>
      <p>Order reference: <strong>${orderData.orderReference}</strong></p>
      <p>Amount: $${orderData.total.toFixed(2)}</p>
      <p>We will ship your order shortly.</p>
      <p>For any questions, reply to this email or contact our support.</p>
    `;
  }
}