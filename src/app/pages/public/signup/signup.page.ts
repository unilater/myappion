import { Component, OnInit } from '@angular/core';
import { LoadingController } from '@ionic/angular';
import { AuthService } from 'src/app/services/auth/auth.service';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ToastService } from 'src/app/services/toast/toast.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-signup',
  templateUrl: './signup.page.html',
  styleUrls: ['./signup.page.scss'],
})
export class SignupPage implements OnInit {

  signup_form: FormGroup;
  submit_attempt: boolean = false;

  constructor(
    private authService: AuthService,
    private loadingController: LoadingController,
    private formBuilder: FormBuilder,
    private toastService: ToastService,
    private router: Router
  ) { }

  ngOnInit() {
    this.signup_form = this.formBuilder.group({
      email: ['', [Validators.email, Validators.required]],
      password: ['', [Validators.minLength(6), Validators.required]],
      password_repeat: ['', [Validators.minLength(6), Validators.required]]
    });
  }

  async signUp() {
    this.submit_attempt = true;

    if (this.signup_form.invalid) {
      this.toastService.presentToast('Error', 'Please fill in all fields correctly', 'top', 'danger', 4000);
      return;
    }

    if (this.signup_form.value.password !== this.signup_form.value.password_repeat) {
      this.toastService.presentToast('Error', 'Passwords must match', 'top', 'danger', 4000);
      return;
    }

    const loading = await this.loadingController.create({
      cssClass: 'default-loading',
      message: '<p>Signing up...</p><span>Please be patient.</span>',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Provo a fare la registrazione
      const res = await this.authService.signUp(this.signup_form.value.email, this.signup_form.value.password);
      
      if (res.success) {
        // Se registrazione ok, login automatico
        const loginRes = await this.authService.signIn(this.signup_form.value.email, this.signup_form.value.password);
        await loading.dismiss();

        if (loginRes.success) {
          this.toastService.presentToast('Welcome!', 'Account created and logged in successfully', 'top', 'success', 2000);
          this.router.navigate(['/home']);
        } else {
          this.toastService.presentToast('Error', 'Account created but failed to login automatically. Please login manually.', 'top', 'danger', 3000);
          this.router.navigate(['/signin']);
        }
      } else {
        await loading.dismiss();
        this.toastService.presentToast('Error', res.message || 'Signup failed', 'top', 'danger', 3000);
      }
    } catch (e) {
      await loading.dismiss();
      this.toastService.presentToast('Error', 'Network or server error', 'top', 'danger', 3000);
    }
  }
}
