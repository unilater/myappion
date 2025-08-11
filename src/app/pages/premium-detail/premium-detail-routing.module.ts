import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { PremiumDetailPage } from './premium-detail.page';

const routes: Routes = [
  {
    path: '',
    component: PremiumDetailPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class PremiumDetailPageRoutingModule {}
