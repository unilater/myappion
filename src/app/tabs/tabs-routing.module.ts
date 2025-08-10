import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TabsPage } from './tabs.page';

const routes: Routes = [
  {
    path: '',
    component: TabsPage,
    children: [
      {
        path: 'home',
        loadChildren: () => import('../pages/secure/home/home.module').then(m => m.HomePageModule)
      },
      {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full'
      },
      {
        path: 'ai',
        loadChildren: () => import('../pages/public/ai/ai.module').then(m => m.AiPageModule)
      },
      {
        path: 'payments',
        loadChildren: () => import('../pages/secure/payments/payments.module').then(m => m.PaymentsPageModule)
      },
      {
        path: 'questionari',
        loadChildren: () => import('../pages/public/questionari/questionari.module').then(m => m.QuestionariPageModule)
      },
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class TabsPageRoutingModule { }
