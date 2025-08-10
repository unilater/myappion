// src/app/pages/public/signin/signin.page.ts
import { Component, OnInit } from '@angular/core';
import { LoadingController } from '@ionic/angular';
import { AuthService } from 'src/app/services/auth/auth.service';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ToastService } from 'src/app/services/toast/toast.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-signin',
  templateUrl: './signin.page.html',
  styleUrls: ['./signin.page.scss'],
})
export class SigninPage implements OnInit {

  signin_form: FormGroup;
  submit_attempt = false;

  constructor(
    private authService: AuthService,
    private loadingController: LoadingController,
    private formBuilder: FormBuilder,
    private toastService: ToastService,
    private router: Router
  ) {}

  ngOnInit() {
    this.signin_form = this.formBuilder.group({
      email: ['', [Validators.email, Validators.required]],
      password: ['', [Validators.minLength(6), Validators.required]]
    });

    // DEBUG: Prefill inputs
    this.signin_form.get('email').setValue('john.doe@mail.com');
    this.signin_form.get('password').setValue('123456');
  }

  async signIn() {
    this.submit_attempt = true;

    if (this.signin_form.invalid) {
      this.toastService.presentToast('Error', 'Please input valid email and password', 'top', 'danger', 2000);
      return;
    }

    const loading = await this.loadingController.create({
      cssClass: 'default-loading',
      message: '<p>Signing in...</p><span>Please be patient.</span>',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      const res = await this.authService.signIn(this.signin_form.value.email, this.signin_form.value.password);
      await loading.dismiss();

      if (res.success) {
        this.router.navigate(['/home']);
      } else {
        this.toastService.presentToast('Error', 'Invalid credentials', 'top', 'danger', 3000);
      }

    } catch (error) {
      await loading.dismiss();
      this.toastService.presentToast('Error', 'Network or server error', 'top', 'danger', 3000);
    }
  }
}
