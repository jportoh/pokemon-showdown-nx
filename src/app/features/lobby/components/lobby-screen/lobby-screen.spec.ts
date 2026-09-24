import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LobbyScreen } from './lobby-screen';

describe('LobbyScreen', () => {
  let component: LobbyScreen;
  let fixture: ComponentFixture<LobbyScreen>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LobbyScreen],
    }).compileComponents();

    fixture = TestBed.createComponent(LobbyScreen);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
