import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
// import { AuthGuard } from './guards/auth.guard';
// import { PublicGuard } from './guards/public.guard';

const routes: Routes = [
  {
    path: '',
    redirectTo: 'welcome', // TODO: Set this to ''
    pathMatch: 'full'
  },

  {
    path: 'welcome',
    loadChildren: () => import('./pages/public/welcome/welcome.module').then(m => m.WelcomePageModule),
    // canActivate: [PublicGuard] // Prevent for signed in users
  },
  {
    path: 'signin',
    loadChildren: () => import('./pages/public/signin/signin.module').then(m => m.SigninPageModule),
    // canActivate: [PublicGuard] // Prevent for signed in users
  },
  {
    path: 'signup',
    loadChildren: () => import('./pages/public/signup/signup.module').then(m => m.SignupPageModule),
    // canActivate: [PublicGuard] // Prevent for signed in users
  },
  {
    path: 'password-reset',
    loadChildren: () => import('./pages/public/password-reset/password-reset.module').then( m => m.PasswordResetPageModule),
    // canActivate: [PublicGuard] // Prevent for signed in users
  },
  {
    path: 'paypal',
    loadChildren: () => import('./pages/payment/paypal/paypal.module').then(m => m.PaypalPageModule)
  },
 // Il questionario ora richiede sempre un ID: /questionario/1, /questionario/2, ...
  {
    path: 'questionario/:id',
    loadChildren: () => import('./pages/public/questionario/questionario.module').then( m => m.QuestionarioPageModule)
  },
  {
    path: '',
    loadChildren: () => import('./pages/secure/secure.module').then(m => m.SecureModule),
    // canActivate: [AuthGuard] // Secure all child pages
  },

  {
    path: 'ai',
    loadChildren: () => import('./pages/public/ai/ai.module').then( m => m.AiPageModule)
  },
  {
    path: 'questionari',
    loadChildren: () => import('./pages/public/questionari/questionari.module').then( m => m.QuestionariPageModule)
  },
];
@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules, onSameUrlNavigation: 'reload' })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule { }