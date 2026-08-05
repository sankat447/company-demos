declare module 'react-native-razorpay' {
  export interface CheckoutOptions {
    key: string;
    order_id?: string;
    amount?: number; // paise
    currency?: string;
    name?: string;
    description?: string;
    prefill?: { contact?: string; email?: string; name?: string };
    theme?: { color?: string };
  }
  export interface CheckoutSuccess {
    razorpay_payment_id: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
  }
  export interface CheckoutError {
    code: number;
    description?: string;
  }
  const RazorpayCheckout: {
    open(options: CheckoutOptions): Promise<CheckoutSuccess>;
  };
  export default RazorpayCheckout;
}
