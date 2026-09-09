import { Component } from '@angular/core';

@Component({
  selector: 'app-about',
  template: `
    <div class="about-page">
      <h1>About Us</h1>
      <p>Amma Wears is a fashion brand dedicated to providing premium apparel with quality materials and comfortable designs. We blend thoughtful design with premium quality to bring refined comfort and confident style to every customer.</p>
    </div>`,
  styles: [`
    .about-page {
      padding: 2rem;
      max-width: 800px;
      margin: 0 auto;
    }
    h1 {
      color: #333;
      margin-bottom: 1rem;
    }
  `]
})
export class AboutComponent {
  constructor() {}
}