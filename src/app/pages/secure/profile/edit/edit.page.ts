import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { NavController, ActionSheetController } from '@ionic/angular';
import { ToastService } from 'src/app/services/toast/toast.service';
import { DataService } from 'src/app/services/data/data.service';
import { Storage } from '@ionic/storage-angular';

@Component({
  selector: 'app-edit',
  templateUrl: './edit.page.html',
  styleUrls: ['./edit.page.scss'],
})
export class EditPage implements OnInit {

  edit_profile_form!: FormGroup;
  submit_attempt = false;
  userId: number | null = null;
  userEmail = '';

  constructor(
    private formBuilder: FormBuilder,
    private toastService: ToastService,
    private navController: NavController,
    private actionSheetController: ActionSheetController, // (ok tenerlo anche se non lo usi ora)
    private dataService: DataService,
    private storage: Storage
  ) {}

  async ngOnInit() {
    // init form
    this.edit_profile_form = this.formBuilder.group({
      name_first: ['', Validators.required],
      name_last: ['', Validators.required]
    });

    // storage ready + user id robusto
    await this.storage.create();
    const rawId = await this.storage.get('user_id');
    const parsed = Number(rawId);
    this.userId = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

    if (this.userId) {
      await this.loadProfile();
    } else {
      this.toastService.presentToast('Error', 'User ID not found. Please login again.', 'top', 'danger', 3000);
      this.navController.navigateBack('/signin');
    }
  }

  async loadProfile() {
    // 1) prova da cache locale (se presente)
    const localProfile = await this.storage.get('user_profile');
    if (localProfile) {
      this.edit_profile_form.patchValue({
        name_first: localProfile.name_first ?? '',
        name_last:  localProfile.name_last  ?? ''
      });
      this.userEmail = localProfile.email ?? this.userEmail;
    }

    // 2) poi aggiorna da backend
    this.dataService.getProfile(this.userId!).subscribe({
      next: async (res: any) => {
        // il tuo service restituisce { success, data: { name_first, name_last, email } }
        const ok = res?.success === true || res?.success === 'true';
        const profile = res?.data ?? null;

        if (ok && profile) {
          const name_first = (profile.name_first ?? '').toString();
          const name_last  = (profile.name_last  ?? '').toString();
          const email      = (profile.email      ?? '').toString();

          this.edit_profile_form.patchValue({ name_first, name_last });
          this.userEmail = email;

          // aggiorna cache locale
          await this.storage.set('user_profile', { name_first, name_last, email });
        } else {
          const msg = res?.message || 'Unable to load profile';
          this.toastService.presentToast('Error', msg, 'top', 'danger', 2000);
        }
      },
      error: () => {
        this.toastService.presentToast('Error', 'Network error', 'top', 'danger', 2000);
      }
    });
  }

  async updateProfilePicture() {
    // TODO: implementare se necessario
  }

  submit() {
    this.submit_attempt = true;

    if (!this.userId) {
      this.toastService.presentToast('Error', 'User ID not found', 'top', 'danger', 2000);
      return;
    }

    if (this.edit_profile_form.invalid) {
      this.toastService.presentToast('Error', 'Please fill in all required fields', 'top', 'danger', 2000);
      return;
    }

    const payload = {
      user_id: this.userId,
      name_first: this.edit_profile_form.value.name_first,
      name_last:  this.edit_profile_form.value.name_last
    };

    this.dataService.updateProfile(payload).subscribe({
      next: async (res: any) => {
        if (res?.success) {
          // aggiorna cache locale
          await this.storage.set('user_profile', {
            name_first: payload.name_first,
            name_last:  payload.name_last,
            email:      this.userEmail
          });

          this.toastService.presentToast('Success', 'Profile saved', 'top', 'success', 2000);
          this.navController.back();
        } else {
          this.toastService.presentToast('Error', res?.message || 'Update failed', 'top', 'danger', 2000);
        }
      },
      error: () => {
        this.toastService.presentToast('Error', 'Network error', 'top', 'danger', 2000);
      }
    });
  }
}
