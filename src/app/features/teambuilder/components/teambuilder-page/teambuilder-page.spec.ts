import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TeambuilderPage } from './teambuilder-page';

describe('TeambuilderPage', () => {
  let component: TeambuilderPage;
  let fixture: ComponentFixture<TeambuilderPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TeambuilderPage],
    }).compileComponents();

    fixture = TestBed.createComponent(TeambuilderPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
